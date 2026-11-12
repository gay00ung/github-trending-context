(() => {
  const { repositoryName } = globalThis.TrendingContext;
  const dayMs = 86_400_000;
  const toDay = millis => Math.floor(millis / dayMs);
  const isoDate = day => new Date(day * dayMs).toISOString().slice(0, 10);
  const isCount = count => Number.isSafeInteger(count) && count >= 0;

  function analyzeRepositoryStars(weeks, createdAt, collectedAt) {
    const created = toDay(Date.parse(createdAt));
    const through = toDay(collectedAt) - 2;
    if (!Array.isArray(weeks) || !Number.isFinite(created)) throw new Error("Invalid star history");
    const counts = new Map();
    for (const week of weeks) {
      if (!Number.isSafeInteger(week?.week) || !Array.isArray(week.days) || week.days.length !== 7) {
        throw new Error("Invalid star history week");
      }
      const start = toDay(week.week * 1000);
      for (const [offset, stars] of week.days.entries()) {
        if (stars === null) continue;
        const day = start + offset;
        if (!isCount(stars) || counts.has(day)) throw new Error("Invalid daily star count");
        counts.set(day, stars);
      }
    }

    const dailyStars = [];
    const first = Math.max(created, through - 13);
    for (let day = first; day <= through; day++) {
      dailyStars.push({ date: isoDate(day), stars: counts.get(day) ?? null });
    }

    let spike = { status: "insufficient" };
    // Keep the comparison consistent with collector/analysis.py.
    for (let day = through; day >= first && day - 7 >= created; day--) {
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
    return { dailyStars, spike, analysisThrough: isoDate(through) };
  }

  async function getPublicJson(url) {
    const response = await fetch(url, {
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
    return response.json();
  }

  async function fetchRepositoryStars(repo) {
    const endpoint = "https://api.github.com/repos/" + repo;
    const metadata = await getPublicJson(endpoint);
    if (metadata?.private !== false || typeof metadata.full_name !== "string"
      || repositoryName("/" + metadata.full_name) !== repo || !isCount(metadata.stargazers_count)) {
      throw new Error("Public repository metadata unavailable");
    }
    const weeks = await getPublicJson(endpoint + "/stargazers/history?per_page=5");
    const collectedAt = Date.now();
    return {
      ...analyzeRepositoryStars(weeks, metadata.created_at, collectedAt),
      collectedAt, totalStars: metadata.stargazers_count,
    };
  }

  Object.assign(globalThis.TrendingContext, { analyzeRepositoryStars, fetchRepositoryStars });
})();
