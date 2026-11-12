import contextlib
import io
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from collector.__main__ import collect, main
from collector.analysis import analyze_stars
from collector.sources import SourceError, dated_events, parse_trending

PEAK = date(2026, 11, 9)
NOW = datetime(2026, 11, 12, 3, tzinfo=timezone.utc)
WEEKS = [
    {"week": int(datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp()), "days": [24] * 7},
    {"week": int(datetime(2026, 11, 8, tzinfo=timezone.utc).timestamp()), "days": [24, 860, 0, None, 999, 0, 0]},
]


class FakeSources:
    def trending(self, period="daily"):
        return ["Owner/Repo", "Owner/Other"]

    def repository(self, repo):
        return {"full_name": repo, "created_at": "2026-10-01T00:00:00Z"}

    def history(self, repo):
        if repo == "Owner/Other":
            raise SourceError("Timeout")
        return WEEKS

    def releases(self, repo):
        raise SourceError("HTTP 502")

    def hn(self, repo, peak):
        return [
            {"objectID": "123", "title": "Show HN", "created_at": "2026-11-09T10:00:00Z",
             "url": "https://github.com/owner/repo/releases"},
        ]


class CollectorTests(unittest.TestCase):
    def test_trending_preserves_order_and_ignores_non_repository_links(self):
        html = """<main><article class="Box-row"><a href="/login">Star</a>
          <h2><a data-first="1" href="/org/z">z</a></h2></article>
          <article class="Box-row"><h2><a href="/org/a">a</a></h2></article>
          <article><h2><a href="/org/ad">ad</a></h2></article></main>"""
        self.assertEqual(parse_trending(html), ["org/z", "org/a"])
        with self.assertRaises(SourceError):
            parse_trending("<h1>Temporary outage</h1>")

    def test_spike_and_actual_zero_with_future_and_missing_days(self):
        history, spike = analyze_stars(WEEKS, date(2026, 10, 1), date(2026, 11, 11))
        self.assertEqual(spike, {"status": "found", "date": PEAK.isoformat(), "stars": 860, "baseline": 24})
        days = {item["date"]: item["stars"] for item in history}
        self.assertEqual(days["2026-11-10"], 0)
        self.assertIsNone(days["2026-11-11"])
        self.assertNotIn("2026-11-12", days)

    def test_new_repository_does_not_get_a_zero_baseline(self):
        history, spike = analyze_stars(WEEKS, PEAK, date(2026, 11, 10))
        self.assertEqual([item["date"] for item in history], ["2026-11-09", "2026-11-10"])
        self.assertEqual(spike["status"], "insufficient")

    def test_hn_match_requires_exact_owner_and_repository_and_nearby_date(self):
        def story(identifier, url, timestamp="2026-11-09T10:00:00Z"):
            return {"objectID": identifier, "url": url, "created_at": timestamp, "title": "Show HN"}
        stories = [
            story("1", "https://github.com/OWNER/repo/releases"),
            story("2", "https://github.com/owner/repo-next"),
            story("3", "https://github.com.evil.test/owner/repo"),
            story("4", "https://other.test/github.com/owner/repo"),
            story("5", "https://github.com/owner/repo", "2026-11-06T00:00:00Z"),
        ]
        self.assertEqual([item["url"] for item in dated_events(stories, "Owner/Repo", PEAK, "hn")],
                         ["https://news.ycombinator.com/item?id=1"])

    def test_partial_failure_keeps_other_sources_and_rank(self):
        with contextlib.redirect_stderr(io.StringIO()):
            data = collect(FakeSources(), 2, lambda: NOW)
        first, second = data["repos"]
        self.assertEqual(data["analysisThrough"], "2026-11-10")
        self.assertEqual(first["sources"]["releases"]["status"], "unavailable")
        self.assertEqual(first["sources"]["hn"]["status"], "found")
        self.assertEqual(second["rank"], 2)
        self.assertEqual(second["spike"]["status"], "unavailable")

    def test_collect_all_writes_separately_ranked_and_labeled_snapshots(self):
        with tempfile.TemporaryDirectory() as folder:
            sources = FakeSources()
            by_period = {
                "daily": ["Owner/Repo"],
                "weekly": ["Owner/Week", "Owner/Repo"],
                "monthly": ["Owner/Month"],
            }
            with patch("collector.__main__.Sources", return_value=sources):
                with patch.object(sources, "trending", side_effect=by_period.__getitem__) as fetch:
                    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(main(["--period", "all", "--output", folder]), 0)
            self.assertEqual([call.args[0] for call in fetch.call_args_list], list(by_period))
            for period, filename in (("daily", "latest.json"), ("weekly", "weekly.json"), ("monthly", "monthly.json")):
                data = json.loads((Path(folder) / filename).read_text())
                self.assertEqual(data["period"], period)
                self.assertEqual([entry["fullName"] for entry in data["repos"]], by_period[period])

    def test_total_failure_keeps_last_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "latest.json"
            output.write_text("previous good snapshot")
            with patch("collector.__main__.Sources", return_value=FakeSources()) as factory:
                with patch.object(factory.return_value, "history", side_effect=SourceError("HTTP 429")):
                    with contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(main(["--output", str(output)]), 1)
            self.assertEqual(output.read_text(), "previous good snapshot")
