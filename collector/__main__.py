import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from .analysis import analyze_stars
from .sources import REPOSITORY_PATH, SNAPSHOT_FILES, SourceError, Sources, dated_events, parse_timestamp


def utc_now():
    return datetime.now(timezone.utc)


def warning(repo, source, error):
    print(f"{repo} [{source}]: {error}", file=sys.stderr)


def event_source(fetch, repo, peak, source):
    try:
        events = dated_events(fetch(), repo, peak, source)
    except SourceError as error:
        warning(repo, source, error)
        return {"status": "unavailable", "items": []}
    return {"status": "found" if events else "none_found", "items": events}


def collect(sources, limit, clock=utc_now, *, period="daily"):
    repos = sources.trending(period)[:limit]
    fetched = clock()
    as_of = fetched.date() - timedelta(days=2)
    entries = []
    history_successes = 0
    for rank, repo in enumerate(repos, start=1):
        canonical = repo
        try:
            metadata = sources.repository(repo)
            created = parse_timestamp(metadata.get("created_at")).date()
            full_name = metadata.get("full_name")
            if isinstance(full_name, str) and REPOSITORY_PATH.fullmatch("/" + full_name):
                canonical = full_name
        except (SourceError, ValueError) as error:
            warning(repo, "repository", error)
            created = None

        try:
            history, spike = analyze_stars(sources.history(repo), created, as_of)
            history_successes += 1
        except (SourceError, ValueError) as error:
            warning(repo, "star history", error)
            history, spike = [], {"status": "unavailable"}

        if spike["status"] == "found":
            peak = date.fromisoformat(spike["date"])
            events = {
                "releases": event_source(lambda: sources.releases(repo), canonical, peak, "releases"),
                "hn": event_source(lambda: sources.hn(canonical, peak), canonical, peak, "hn"),
            }
        else:
            events = {source: {"status": "not_checked", "items": []} for source in ("releases", "hn")}

        entries.append({
            "rank": rank, "fullName": repo, "dailyStars": history, "spike": spike, "sources": events,
        })

    if not history_successes:
        raise SourceError("All star history requests failed")
    return {
        "schemaVersion": 1,
        "period": period,
        "generatedAt": clock().isoformat(),
        "trendingFetchedAt": fetched.isoformat(),
        "analysisThrough": as_of.isoformat(),
        "repos": entries,
    }


def write_snapshot(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
        temporary.replace(path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, choices=range(1, 11), default=10)
    parser.add_argument("--period", choices=[*SNAPSHOT_FILES, "all"], default="daily")
    parser.add_argument("--output", type=Path, help="Snapshot path, or a directory when using --period all")
    args = parser.parse_args(argv)
    sources = Sources()
    periods = list(SNAPSHOT_FILES) if args.period == "all" else [args.period]
    base = Path("build/site")
    try:
        snapshots = {period: collect(sources, args.limit, period=period) for period in periods}
        if sources.github_limited:
            raise SourceError("GitHub API limit reached; keeping the previous snapshots")
        for period, data in snapshots.items():
            filename = SNAPSHOT_FILES[period]
            if args.period == "all":
                path = (args.output or base) / filename
            else:
                path = args.output or base / filename
            write_snapshot(path, data)
            print(f"Wrote {len(data['repos'])} {period} repositories to {path}")
    except (SourceError, OSError) as error:
        print(f"Snapshot collection failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
