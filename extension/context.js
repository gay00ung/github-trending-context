(() => {
  function repositoryName(pathname) {
    const match = /^\/([a-z\d-]+\/[a-z\d_.-]+)\/?$/i.exec(pathname);
    return match?.[1].toLowerCase() ?? null;
  }

  const snapshotFiles = Object.freeze({
    daily: "latest.json", weekly: "weekly.json", monthly: "monthly.json",
  });

  function trendingPeriod(url) {
    if (url.origin !== "https://github.com" || !/^\/trending\/?$/.test(url.pathname)
      || url.searchParams.get("spoken_language_code")) return null;
    const period = url.searchParams.get("since") || "daily";
    return Object.hasOwn(snapshotFiles, period) ? period : null;
  }

  function indexRepositories(entries) {
    return new Map(entries.map(entry => [repositoryName("/" + entry.fullName), entry]));
  }

  globalThis.TrendingContext = { repositoryName, snapshotFiles, trendingPeriod, indexRepositories };
})();
