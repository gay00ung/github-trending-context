(() => {
  const dayMs = 86_400_000;
  const maxCachedRepositories = 128;
  const toDay = millis => Math.floor(millis / dayMs);
  const isoDate = day => new Date(day * dayMs).toISOString().slice(0, 10);
  const isCount = count => Number.isSafeInteger(count) && count >= 0;

  function repositoryAnalysisThrough(time) {
    return isoDate(toDay(time) - 2);
  }

  function analyzeRepositoryStars(weeks, collectedAt, hasEarlierWeeks) {
    const through = toDay(collectedAt) - 2;
    if (!Array.isArray(weeks)) throw new Error("Invalid star history");
    const counts = new Map();
    const weekStarts = new Set();
    let oldest = Infinity;
    for (const week of weeks) {
      if (!Number.isSafeInteger(week?.week) || !Array.isArray(week.days) || week.days.length !== 7) {
        throw new Error("Invalid star history week");
      }
      const start = toDay(week.week * 1000);
      if (weekStarts.has(start)) throw new Error("Duplicate star history week");
      weekStarts.add(start);
      oldest = Math.min(oldest, start);
      for (const [offset, stars] of week.days.entries()) {
        if (stars === null) continue;
        const day = start + offset;
        if (!isCount(stars) || counts.has(day)) throw new Error("Invalid daily star count");
        counts.set(day, stars);
      }
    }

    // The creation week can include zeroes from before the repository existed.
    // Only use its days starting with the first recorded star.
    let knownFrom = oldest;
    if (!hasEarlierWeeks) {
      while (knownFrom < oldest + 7 && !(counts.get(knownFrom) > 0)) knownFrom++;
    }
    const dailyStars = [];
    const first = Math.max(knownFrom, through - 13);
    for (let day = first; day <= through; day++) {
      dailyStars.push({ date: isoDate(day), stars: counts.get(day) ?? null });
    }

    let spike = { status: "insufficient" };
    // Keep the comparison consistent with collector/analysis.py.
    for (let day = through; day >= first && day - 7 >= knownFrom; day--) {
      const stars = counts.get(day);
      const prior = Array.from({ length: 7 }, (_, offset) => counts.get(day - offset - 1));
      if (stars === undefined || prior.includes(undefined)) continue;
      const baseline = prior.sort((a, b) => a - b)[3];
      if (stars >= 100 && stars >= 5 * baseline) {
        spike = { status: "found", date: isoDate(day), stars, baseline };
        break;
      }
      spike = { status: "no_spike" };
    }
    return { dailyStars, spike, analysisThrough: isoDate(through), collectedAt };
  }

  async function fetchRepositoryStars(repo) {
    const endpoint = "https://api.github.com/repos/" + repo + "/stargazers/history?per_page=5";
    const response = await fetch(endpoint, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10000),
    });
    const exhausted = response.headers.get("x-ratelimit-remaining") === "0";
    const retryAfter = Number(response.headers.get("retry-after")) || 0;
    if (response.status === 429 || (response.status === 403 && (exhausted || retryAfter > 0))) {
      const error = new Error("GitHub API rate limit reached");
      const resetAt = exhausted ? Number(response.headers.get("x-ratelimit-reset")) * 1000 || 0 : 0;
      error.retryAt = Math.max(resetAt, Date.now() + Math.max(60, retryAfter) * 1000);
      throw error;
    }
    if (!response.ok) throw new Error("GitHub HTTP " + response.status);
    const hasEarlierWeeks = /;\s*rel="next"/.test(response.headers.get("link") ?? "");
    return analyzeRepositoryStars(await response.json(), Date.now(), hasEarlierWeeks);
  }

  function createRepositoryLoader({ readCache, saveCache, fetchStars = fetchRepositoryStars, now = Date.now }) {
    const pending = new Map();
    let loadedCache;
    let writes = Promise.resolve();

    function getCache() {
      loadedCache ??= readCache().catch(() => null).then(saved => ({
        reports: new Map(Object.entries(saved?.reports ?? {})),
        retryAt: saved?.retryAt ?? 0,
      }));
      return loadedCache;
    }

    function persist(cache) {
      const saved = { reports: Object.fromEntries(cache.reports), retryAt: cache.retryAt };
      writes = writes.then(() => saveCache(saved)).catch(() => {});
      return writes;
    }

    async function load(repo) {
      const cache = await getCache();
      const previous = cache.reports.get(repo);
      if (previous?.analysisThrough === repositoryAnalysisThrough(now())) return { repository: previous };
      const fallback = error => previous ? { repository: previous, stale: true, error } : { error };
      if (cache.retryAt > now()) return fallback("rate_limited");
      try {
        const report = await fetchStars(repo);
        cache.reports.delete(repo);
        cache.reports.set(repo, report);
        if (cache.reports.size > maxCachedRepositories) cache.reports.delete(cache.reports.keys().next().value);
        await persist(cache);
        return { repository: report };
      } catch (error) {
        if (error.retryAt) {
          cache.retryAt = Math.max(cache.retryAt, error.retryAt);
          await persist(cache);
        }
        return fallback(error.retryAt ? "rate_limited" : "unavailable");
      }
    }

    return repo => {
      if (!pending.has(repo)) pending.set(repo, load(repo).finally(() => pending.delete(repo)));
      return pending.get(repo);
    };
  }

  Object.assign(globalThis.TrendingContext, { analyzeRepositoryStars, createRepositoryLoader, repositoryAnalysisThrough });
})();
