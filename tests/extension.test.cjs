const test = require("node:test");
const assert = require("node:assert/strict");
require("../extension/context.js");
require("../extension/snapshot.js");
require("../extension/repository.js");

const {
  trendingPeriod, indexRepositories, validSnapshot, createSnapshotLoader, isStale, analyzeRepositoryStars,
} = globalThis.TrendingContext;
const now = Date.parse("2026-11-12T03:00:00Z");
const payload = {
  schemaVersion: 1,
  generatedAt: "2026-11-12T02:59:00Z",
  trendingFetchedAt: "2026-11-12T02:58:00Z",
  analysisThrough: "2026-11-10",
  repos: [{
    rank: 1, fullName: "Owner/Repo",
    dailyStars: [{ date: "2026-11-10", stars: 100 }],
    spike: { status: "found", date: "2026-11-10", stars: 100, baseline: 0 },
    sources: {
      hn: { status: "found", items: [{ date: "2026-11-10", title: "Show HN", url: "https://news.ycombinator.com/item?id=123" }] },
      releases: { status: "unavailable", items: [] },
    },
  }],
};

test("each all-language Trending range resolves to its own period", () => {
  const url = path => new URL("https://github.com" + path);
  for (const path of ["/trending", "/trending?since=daily", "/trending?spoken_language_code="]) {
    assert.equal(trendingPeriod(url(path)), "daily");
  }
  assert.equal(trendingPeriod(url("/trending?since=weekly")), "weekly");
  assert.equal(trendingPeriod(url("/trending?since=monthly")), "monthly");
  for (const path of ["/trending?since=unknown", "/trending/rust",
    "/trending?spoken_language_code=en", "/owner/repo", "/trending-tools"]) {
    assert.equal(trendingPeriod(url(path)), null);
  }
});

test("a period loader ignores the other periods' snapshots", async () => {
  const weekly = { ...payload, period: "weekly" };
  const monthly = { ...payload, period: "monthly" };
  assert.equal(validSnapshot(weekly, "weekly"), true);
  assert.equal(validSnapshot(monthly, "monthly"), true);
  assert.equal(validSnapshot(weekly, "monthly"), false);
  assert.equal(validSnapshot(payload, "weekly"), false);
  const load = createSnapshotLoader({
    period: "monthly",
    readCache: async () => ({ snapshot: weekly, fetchedAt: now }),
    saveCache: async () => assert.fail("another period must not be cached"),
    fetchSnapshot: async () => payload,
    now: () => now,
  });
  assert.deepEqual(await load(), { unavailable: true });
});

test("repository matching is exact and case-insensitive", () => {
  const indexed = indexRepositories(payload.repos);
  assert.equal(indexed.get("owner/repo"), payload.repos[0]);
  assert.equal(indexed.get("owner/repo-old"), undefined);
  assert.equal(indexed.get("other/repo"), undefined);
});

test("snapshot rejects unsafe links, inconsistent counts, and wrong versions", () => {
  assert.equal(validSnapshot(payload), true);
  const modified = structuredClone(payload);
  modified.repos[0].sources.hn.items[0].url = "javascript:alert(1)";
  assert.equal(validSnapshot(modified), false);
  assert.equal(validSnapshot({ ...payload, schemaVersion: 2 }), false);
  assert.equal(validSnapshot({ ...payload, analysisThrough: "2026-02-31" }), false);
  assert.equal(validSnapshot({ ...payload, repos: [] }), false);
  const inconsistent = structuredClone(payload);
  inconsistent.repos[0].spike.stars = 999;
  assert.equal(validSnapshot(inconsistent), false);
});

test("concurrent loads share the request and reuse a fresh cache", async () => {
  let cache;
  let calls = 0;
  const load = createSnapshotLoader({
    readCache: async () => cache,
    saveCache: async value => { cache = value; },
    fetchSnapshot: async () => { calls++; return payload; },
    now: () => now,
  });
  const results = await Promise.all([load(), load(), load()]);
  assert.ok(results.every(result => result.snapshot === payload));
  assert.equal((await load()).snapshot, payload);
  assert.equal(calls, 1);
});

test("malformed responses and network errors preserve the last valid cache", async () => {
  const cached = { snapshot: payload, fetchedAt: now - 2 * 60 * 60 * 1000 };
  const common = {
    readCache: async () => cached,
    saveCache: async () => assert.fail("bad data must not overwrite the cache"),
    now: () => now,
  };
  const malformed = createSnapshotLoader({ ...common, fetchSnapshot: async () => ({ invalid: true }) });
  const networkError = createSnapshotLoader({ ...common, fetchSnapshot: async () => { throw new Error("offline"); } });
  assert.deepEqual(await malformed(), { snapshot: payload, fallback: true });
  assert.deepEqual(await networkError(), { snapshot: payload, fallback: true });
  const cold = createSnapshotLoader({ ...common, readCache: async () => undefined, fetchSnapshot: async () => ({}) });
  assert.deepEqual(await cold(), { unavailable: true });
  assert.equal(isStale(payload, now), false);
  assert.equal(isStale(payload, now + 37 * 60 * 60 * 1000), true);
});

test("repository star analysis matches the collector cutoff, baseline, and missing data", () => {
  const weeks = [
    { week: Date.parse("2026-11-08") / 1000, days: [24, 860, 0, null, 999, 0, 0] },
    { week: Date.parse("2026-11-01") / 1000, days: Array(7).fill(24) },
  ];
  const report = analyzeRepositoryStars(weeks, "2026-10-01T12:00:00Z", now);
  assert.equal(report.analysisThrough, "2026-11-10");
  assert.equal(report.dailyStars.length, 14);
  assert.equal(report.dailyStars.at(-1).stars, 0);
  assert.equal(report.dailyStars[0].stars, null);
  assert.deepEqual(report.spike, { status: "found", date: "2026-11-09", stars: 860, baseline: 24 });

  const newRepo = analyzeRepositoryStars(weeks, "2026-11-09T12:00:00Z", now);
  assert.deepEqual(newRepo.dailyStars.map(day => day.stars), [860, 0]);
  assert.equal(newRepo.spike.status, "insufficient");
  assert.throws(() => analyzeRepositoryStars([weeks[0], weeks[0]], "2026-10-01T12:00:00Z", now));
});
