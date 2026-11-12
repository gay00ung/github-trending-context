(() => {
  function repositoryName(pathname) {
    const match = /^\/([a-z\d-]+\/[a-z\d_.-]+)\/?$/i.exec(pathname);
    return match?.[1].toLowerCase() ?? null;
  }

  function isDailyTrending(url) {
    return url.origin === "https://github.com"
      && /^\/trending\/?$/.test(url.pathname)
      && ["", "daily"].includes(url.searchParams.get("since") ?? "")
      && !url.searchParams.get("spoken_language_code");
  }

  globalThis.TrendingContext = { repositoryName, isDailyTrending };
})();
