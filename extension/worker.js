importScripts("config.js", "context.js", "snapshot.js", "repository.js");

const {
  snapshotFiles, trendingPeriod, createSnapshotLoader, isStale, validSnapshot,
  repositoryName, createRepositoryLoader,
} = globalThis.TrendingContext;
const { mode, url } = globalThis.TrendingContextConfig;

async function getJson(endpoint, options = {}) {
  const response = await fetch(endpoint, { ...options, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Snapshot HTTP " + response.status);
  return response.json();
}

function hostedLoader(period, filename) {
  const cacheKey = period === "daily" ? "trending-snapshot-v1" : "trending-snapshot-v1-" + period;
  return createSnapshotLoader({
    period,
    readCache: async () => (await chrome.storage.local.get(cacheKey))[cacheKey],
    saveCache: cache => chrome.storage.local.set({ [cacheKey]: cache }),
    fetchSnapshot: () => getJson(new URL(filename, url), { credentials: "omit", redirect: "error", cache: "no-store" }),
  });
}

const loadHosted = Object.fromEntries(
  Object.entries(snapshotFiles).map(([period, filename]) => [period, hostedLoader(period, filename)]),
);

async function readContext(period) {
  if (mode === "demo") {
    return { demo: await getJson(chrome.runtime.getURL("fixtures/demo.json")) };
  }
  const result = mode === "local"
    ? { snapshot: await getJson(chrome.runtime.getURL(snapshotFiles[period]), { cache: "no-store" }) }
    : await loadHosted[period]();
  if (!validSnapshot(result.snapshot, period)) return { unavailable: true };
  return { ...result, stale: isStale(result.snapshot) };
}

const repositoryCacheKey = "repository-star-history-v1";
const readRepository = createRepositoryLoader({
  readCache: async () => (await chrome.storage.local.get(repositoryCacheKey))[repositoryCacheKey],
  saveCache: cache => chrome.storage.local.set({ [repositoryCacheKey]: cache }),
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.frameId !== 0 || !sender.url) return false;
  const url = new URL(sender.url);
  if (message?.type === "trending-context:repository") {
    const repo = url.origin === "https://github.com" && repositoryName(url.pathname);
    if (mode === "demo" || !repo || message.repo !== repo) return false;
    readRepository(repo).then(respond, () => respond({ error: "unavailable" }));
    return true;
  }
  if (message?.type !== "trending-context:snapshot") return false;
  const period = trendingPeriod(url);
  if (!period || message.period !== period) return false;
  readContext(period).then(respond, () => respond({ unavailable: true }));
  return true;
});
