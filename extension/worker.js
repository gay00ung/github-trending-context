importScripts("config.js", "context.js", "snapshot.js");

const { isDailyTrending, createSnapshotLoader, isStale, validSnapshot } = globalThis.TrendingContext;
const { mode, url } = globalThis.TrendingContextConfig;
const cacheKey = "trending-snapshot-v1";

async function getJson(endpoint, options = {}) {
  const response = await fetch(endpoint, { ...options, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Snapshot HTTP " + response.status);
  return response.json();
}

const loadHosted = createSnapshotLoader({
  readCache: async () => (await chrome.storage.local.get(cacheKey))[cacheKey],
  saveCache: cache => chrome.storage.local.set({ [cacheKey]: cache }),
  fetchSnapshot: () => getJson(url, { credentials: "omit", redirect: "error", cache: "no-store" }),
});

async function readContext() {
  if (mode === "demo") {
    return { demo: await getJson(chrome.runtime.getURL("fixtures/demo.json")) };
  }
  const result = mode === "local"
    ? { snapshot: await getJson(chrome.runtime.getURL("latest.json")) }
    : await loadHosted();
  if (!validSnapshot(result.snapshot)) return { unavailable: true };
  return { ...result, stale: isStale(result.snapshot) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "trending-context:snapshot" || sender.frameId !== 0 || !sender.url
    || !isDailyTrending(new URL(sender.url))) return false;
  readContext().then(respond, () => respond({ unavailable: true }));
  return true;
});
