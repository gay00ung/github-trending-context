importScripts("config.js", "context.js", "snapshot.js");

const { snapshotFiles, trendingPeriod, createSnapshotLoader, isStale, validSnapshot } = globalThis.TrendingContext;
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
    ? { snapshot: await getJson(chrome.runtime.getURL(snapshotFiles[period])) }
    : await loadHosted[period]();
  if (!validSnapshot(result.snapshot, period)) return { unavailable: true };
  return { ...result, stale: isStale(result.snapshot) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "trending-context:snapshot" || sender.frameId !== 0 || !sender.url) return false;
  const period = trendingPeriod(new URL(sender.url));
  if (!period || message.period !== period) return false;
  readContext(period).then(respond, () => respond({ unavailable: true }));
  return true;
});
