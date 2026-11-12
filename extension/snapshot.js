(() => {
  const { repositoryName } = globalThis.TrendingContext;
  const hour = 60 * 60 * 1000;
  const sourceStates = new Set(["found", "none_found", "unavailable", "not_checked"]);
  const comparisonStates = new Set(["found", "no_spike", "insufficient", "unavailable"]);

  function calendarDate(date) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const value = new Date(date);
    return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
  }

  function count(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validEvent(event, source) {
    if (!calendarDate(event?.date) || typeof event.title !== "string" || !event.title.trim()) return false;
    try {
      const url = new URL(event.url);
      if (url.username || url.password || url.protocol !== "https:" || url.port) return false;
      if (source === "hn") {
        return url.hostname === "news.ycombinator.com" && url.pathname === "/item"
          && /^\d+$/.test(url.searchParams.get("id") ?? "");
      }
      return url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/releases\/(?:tag|download)\//.test(url.pathname);
    } catch {
      return false;
    }
  }

  function validSource(source, name) {
    return sourceStates.has(source?.status)
      && Array.isArray(source.items)
      && source.items.length <= 20
      && (source.items.length > 0) === (source.status === "found")
      && source.items.every(event => validEvent(event, name));
  }

  function validRepository(entry, index) {
    if (entry?.rank !== index + 1 || typeof entry.fullName !== "string"
      || !repositoryName("/" + entry.fullName)) return false;
    const { dailyStars, spike, sources } = entry;
    if (!Array.isArray(dailyStars) || dailyStars.length > 14 || !comparisonStates.has(spike?.status)) return false;
    if (!dailyStars.every((day, i) => calendarDate(day?.date)
      && (day.stars === null || count(day.stars))
      && (!i || dailyStars[i - 1].date < day.date))) return false;
    if (spike.status === "found" && (!calendarDate(spike.date) || !count(spike.stars) || !count(spike.baseline)
      || !dailyStars.some(day => day.date === spike.date && day.stars === spike.stars))) return false;
    return validSource(sources?.hn, "hn") && validSource(sources?.releases, "releases");
  }

  function validSnapshot(value) {
    return value?.schemaVersion === 1
      && typeof value.generatedAt === "string" && Number.isFinite(Date.parse(value.generatedAt))
      && typeof value.trendingFetchedAt === "string" && Number.isFinite(Date.parse(value.trendingFetchedAt))
      && Date.parse(value.trendingFetchedAt) <= Date.parse(value.generatedAt)
      && calendarDate(value.analysisThrough)
      && Array.isArray(value.repos) && value.repos.length > 0 && value.repos.length <= 10
      && value.repos.every(validRepository)
      && new Set(value.repos.map(entry => repositoryName("/" + entry.fullName))).size === value.repos.length;
  }

  function createSnapshotLoader({ readCache, saveCache, fetchSnapshot, now = Date.now }) {
    let pending;

    async function load() {
      const cached = await readCache().catch(() => null);
      const hasCache = validSnapshot(cached?.snapshot);
      if (hasCache && count(cached.fetchedAt) && now() - cached.fetchedAt < hour) {
        return { snapshot: cached.snapshot };
      }

      try {
        const snapshot = await fetchSnapshot();
        if (!validSnapshot(snapshot)) throw new Error("Unexpected snapshot data");
        await saveCache({ snapshot, fetchedAt: now() }).catch(() => {});
        return { snapshot };
      } catch {
        return hasCache ? { snapshot: cached.snapshot, fallback: true } : { unavailable: true };
      }
    }

    return () => {
      pending ??= load().finally(() => { pending = undefined; });
      return pending;
    };
  }

  function isStale(snapshot, now = Date.now()) {
    return now - Date.parse(snapshot.trendingFetchedAt) > 36 * hour;
  }

  Object.assign(globalThis.TrendingContext, { validSnapshot, createSnapshotLoader, isStale });
})();
