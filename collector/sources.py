import json
import re
from os import getenv
from datetime import datetime, time, timedelta, timezone
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

TRENDING_URL = "https://github.com/trending"
SNAPSHOT_FILES = {"daily": "latest.json", "weekly": "weekly.json", "monthly": "monthly.json"}
GITHUB_API = "https://api.github.com"
HN_SEARCH = "https://hn.algolia.com/api/v1/search"
REPOSITORY_PATH = re.compile(r"/([a-z0-9-]+/[a-z0-9_.-]+)/?", re.IGNORECASE | re.ASCII)


class SourceError(Exception):
    """An upstream resource was unavailable or its response was unusable."""


class TrendingParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.repositories = []
        self.seen = set()
        self.in_row = False
        self.in_heading = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "article":
            self.in_row = "Box-row" in (attributes.get("class") or "").split()
        elif tag == "h2" and self.in_row:
            self.in_heading = True
        elif tag == "a" and self.in_heading:
            match = REPOSITORY_PATH.fullmatch(attributes.get("href") or "")
            if match and match[1].lower() not in self.seen:
                self.repositories.append(match[1])
                self.seen.add(match[1].lower())

    def handle_endtag(self, tag):
        if tag == "h2":
            self.in_heading = False
        elif tag == "article":
            self.in_row = self.in_heading = False


def parse_trending(html):
    parser = TrendingParser()
    parser.feed(html)
    parser.close()
    if not parser.repositories:
        raise SourceError("No repository headings in the Trending page")
    return parser.repositories


def parse_timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include its timezone")
    return parsed.astimezone(timezone.utc)


def matching_repository_url(value, repo):
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        segments = url.path.strip("/").lower().split("/")
        return (
            url.scheme in ("https", "http")
            and url.netloc.lower() == "github.com"
            and "/".join(segments[:2]) == repo.lower()
        )
    except ValueError:
        return False


def dated_events(items, repo, peak, source):
    matches = []
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        if source == "hn":
            if not matching_repository_url(item.get("url"), repo):
                continue
            identifier = str(item.get("objectID", ""))
            if not re.fullmatch(r"[0-9]+", identifier):
                continue
            url = f"https://news.ycombinator.com/item?id={identifier}"
            title = item.get("title")
            timestamp = item.get("created_at")
        else:
            url = item.get("html_url")
            if item.get("draft") or not matching_repository_url(url, repo):
                continue
            title = item.get("name") or item.get("tag_name")
            timestamp = item.get("published_at")

        try:
            day = parse_timestamp(timestamp).date()
        except ValueError:
            continue
        if abs((day - peak).days) > 1 or not isinstance(title, str) or not title.strip() or url in seen:
            continue
        matches.append({"date": day.isoformat(), "title": title.strip(), "url": url})
        seen.add(url)
    return sorted(matches, key=lambda item: (item["date"], item["url"]))


class Sources:
    def __init__(self):
        self.github_limited = False
        self.github_token = getenv("GITHUB_TOKEN")
        self.github_responses = {}

    def get(self, url, *, github=False):
        headers = {"User-Agent": "github-trending-context/0.1"}
        if github:
            if self.github_limited:
                raise SourceError("GitHub API limit reached")
            headers.update({
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2026-03-10",
            })
        request = Request(url, headers=headers)
        if github and self.github_token:
            request.add_unredirected_header("Authorization", f"Bearer {self.github_token}")
        try:
            with urlopen(request, timeout=15) as response:
                return response.read().decode("utf-8")
        except HTTPError as error:
            if github and (
                error.code == 429 or
                error.code == 403 and (
                    error.headers.get("X-RateLimit-Remaining") == "0" or error.headers.get("Retry-After")
                )
            ):
                self.github_limited = True
            raise SourceError(f"HTTP {error.code}") from error
        except (OSError, URLError, UnicodeError) as error:
            raise SourceError(type(error).__name__) from error

    def get_json(self, url, expected_type, *, github=False):
        if github and url in self.github_responses:
            return self.github_responses[url]
        try:
            data = json.loads(self.get(url, github=github))
        except ValueError as error:
            raise SourceError("Invalid JSON") from error
        if not isinstance(data, expected_type):
            raise SourceError("Unexpected JSON shape")
        if github:
            self.github_responses[url] = data
        return data

    def trending(self, period="daily"):
        if period not in SNAPSHOT_FILES:
            raise ValueError(f"Unsupported Trending period: {period}")
        return parse_trending(self.get(f"{TRENDING_URL}?since={period}"))

    def repository(self, repo):
        return self.get_json(f"{GITHUB_API}/repos/{repo}", dict, github=True)

    def history(self, repo):
        return self.get_json(f"{GITHUB_API}/repos/{repo}/stargazers/history?per_page=5", list, github=True)

    def releases(self, repo):
        return self.get_json(f"{GITHUB_API}/repos/{repo}/releases?per_page=10", list, github=True)

    def hn(self, repo, peak):
        start = datetime.combine(peak - timedelta(days=1), time.min, timezone.utc)
        end = start + timedelta(days=3)
        query = urlencode({
            "query": f"github.com/{repo}",
            "tags": "story",
            "hitsPerPage": 20,
            "numericFilters": f"created_at_i>={int(start.timestamp())},created_at_i<{int(end.timestamp())}",
        })
        data = self.get_json(f"{HN_SEARCH}?{query}", dict)
        if not isinstance(data.get("hits"), list):
            raise SourceError("Missing Hacker News hits")
        return data["hits"]
