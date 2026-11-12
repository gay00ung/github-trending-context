(() => {
  const { repositoryName, trendingPeriod, indexRepositories } = globalThis.TrendingContext;
  const { mode } = globalThis.TrendingContextConfig;
  const selector = ".trending-context";
  const numbers = new Intl.NumberFormat("en");
  const timestamp = new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  const sourceNames = { hn: "Hacker News", releases: "Releases" };
  const refreshInterval = 5 * 60 * 1000;
  const dataByPeriod = new Map();
  const pending = new Set();
  let renderedPeriod;
  let repositoryView;
  let frame;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function shortDate(date) {
    return date.slice(5).replace("-", "/");
  }

  function stars(value) {
    return "+" + numbers.format(value);
  }

  function evidenceLink(event, source) {
    const item = element("li");
    const link = element("a", "", event.title);
    link.href = event.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const date = element("time", "", shortDate(event.date));
    date.dateTime = event.date;
    item.append(date, link, element("span", "trending-context-muted", sourceNames[source]));
    return item;
  }

  function historyChart(days, peakDate) {
    const chart = element("ol", "trending-context-chart");
    chart.setAttribute("aria-label", "Daily stars");
    const peak = Math.max(1, ...days.map(({ stars }) => stars ?? 0));
    for (const day of days) {
      const bar = element("li", day.date === peakDate ? "is-peak" : "");
      bar.style.setProperty("--bar-height", Math.max(3, (day.stars ?? 0) / peak * 100) + "%");
      if (day.stars === null) bar.classList.add("is-missing");
      const label = day.date + (day.stars === null ? ": unavailable" : ": " + stars(day.stars) + " stars");
      bar.title = label;
      bar.append(element("span", "trending-context-sr-only", label));
      chart.append(bar);
    }
    return chart;
  }

  function appendHistory(body, dailyStars, spike) {
    if (!dailyStars.length) return;
    body.append(element("p", "trending-context-label", "Daily stars"));
    body.append(historyChart(dailyStars, spike?.date));
    const dates = element("div", "trending-context-dates");
    dates.append(element("span", "", shortDate(dailyStars[0].date)), element("span", "", shortDate(dailyStars.at(-1).date)));
    body.append(dates);
  }

  function sourceSummary(sources) {
    return Object.entries(sourceNames).flatMap(([key, name]) => {
      const { status, items } = sources[key];
      if (status === "found") return name + " " + items.length;
      if (status === "unavailable") return name + " unavailable";
      if (status === "none_found") return "No matching " + (key === "hn" ? "HN posts" : "releases");
      return [];
    }).join(" · ");
  }

  function comparisonSummary(spike) {
    switch (spike?.status) {
      case "found":
        return shortDate(spike.date) + " · " + stars(spike.stars) + " ★ · 7-day median " + stars(spike.baseline);
      case "no_spike": return "No spike in the comparison window";
      case "insufficient": return "Too little history to compare";
      case "unavailable": return "Star history unavailable";
      default: return "Star history";
    }
  }

  function panel(entry, key, data) {
    const { dailyStars, sources } = entry;
    const spike = data.demo && entry.spike ? { status: "found", ...entry.spike } : entry.spike;
    const details = element("details", "trending-context");
    details.dataset.contextKey = key;
    const summary = element("summary");
    const label = data.demo ? "Example data" : "Trending Context";
    summary.append(element("span", "trending-context-demo", label));
    summary.append(element("span", "", comparisonSummary(spike)));
    if (spike?.status === "found") {
      summary.append(element("span", "trending-context-muted", sourceSummary(sources)));
    }
    if (data.stale || data.fallback) {
      summary.append(element("span", "trending-context-muted", data.stale ? "Older snapshot" : "Saved snapshot"));
    }
    details.append(summary);

    const body = element("div", "trending-context-body");
    appendHistory(body, dailyStars, spike);
    if (spike?.status === "found") {
      const list = element("ul", "trending-context-evidence");
      for (const key of Object.keys(sourceNames)) {
        list.append(...sources[key].items.map(item => evidenceLink(item, key)));
      }
      if (list.childElementCount) {
        body.append(element("p", "trending-context-label", data.demo ? "Example source links" : "Public activity near the spike"), list);
      }
      if (!data.demo) {
        body.append(element("p", "trending-context-note", "Search window: one day either side. Dates show timing only."));
      }
    }
    if (data.snapshot) {
      const { analysisThrough, trendingFetchedAt } = data.snapshot;
      body.append(element("p", "trending-context-note",
        "Compared through " + analysisThrough + " · Collected " + timestamp.format(new Date(trendingFetchedAt))));
    }
    details.append(body);
    return details;
  }

  function notice(text, key, timestampValue) {
    const node = element("p", "trending-context trending-context-notice", text);
    node.dataset.contextKey = key;
    if (timestampValue) {
      node.append(document.createTextNode(" · Collected " + timestamp.format(new Date(timestampValue))));
    }
    return node;
  }

  function rowsInView() {
    const rows = [];
    for (const row of document.querySelectorAll("main article.Box-row")) {
      const link = row.querySelector("h2 a");
      if (!link) continue;
      const url = new URL(link.href);
      const name = url.origin === location.origin && repositoryName(url.pathname);
      if (name) rows.push({ row, name });
      if (rows.length === 10) break;
    }
    return rows;
  }

  function insert(row, key, render) {
    const current = row.querySelector(selector);
    if (current?.dataset.contextKey === key) return;
    const next = render();
    if (next.tagName === "DETAILS" && current?.open) next.open = true;
    if (current) {
      current.replaceWith(next);
      return;
    }
    const anchor = row.querySelector(":scope > p:not(.trending-context)") ?? row.querySelector("h2");
    anchor.after(next);
  }

  async function loadPeriod(period) {
    if (pending.has(period)) return;
    pending.add(period);
    try {
      const result = await chrome.runtime.sendMessage({ type: "trending-context:snapshot", period });
      if (result?.snapshot || result?.demo) dataByPeriod.set(period, result);
    } catch {
      // Keep the last snapshot when a refresh fails.
    } finally {
      if (!dataByPeriod.has(period)) dataByPeriod.set(period, { unavailable: true });
      pending.delete(period);
      schedule();
    }
  }

  function publicRepository(url) {
    const name = repositoryName(url.pathname);
    if (!name || mode === "demo") return null;
    const meta = key => document.head.querySelector('meta[name="octolytics-dimension-repository_' + key + '"]')?.content;
    if (repositoryName("/" + meta("nwo")) !== name) return null;
    const visibility = meta("public");
    if (visibility !== undefined) return visibility === "true" ? name : null;
    const label = document.querySelector('[data-testid="repo-visibility-label"]');
    return label?.textContent.trim() === "Public" ? name : null;
  }

  function displayedStarCount(repo) {
    const counters = document.querySelectorAll([
      "#repo-stars-counter-star", "#repo-stars-counter-unstar",
      '[data-testid="star-button"] [data-component="CounterLabel"]',
      '[data-testid="unstar-button"] [data-component="CounterLabel"]',
    ].join(","));
    const links = [...document.querySelectorAll('a[href$="/stargazers"]')].filter(link =>
      new URL(link.href).pathname.toLowerCase() === "/" + repo + "/stargazers");
    for (const node of [...counters, ...links]) {
      if (!node.getClientRects().length) continue;
      for (const raw of [node.title, node.textContent]) {
        const match = /^([\d,.\u00a0\u202f ]+\d|\d)([kmb]?)\s*(?:stars?)?$/i.exec(raw.trim());
        if (match) return match[1] + match[2];
      }
    }
    return "";
  }

  function createRepositoryView(name) {
    const container = element("div", "trending-context-repository");
    const details = element("details", "trending-context");
    const summary = element("summary");
    const comparison = element("span");
    const total = element("span", "trending-context-muted");
    comparison.hidden = total.hidden = true;
    summary.append(element("span", "trending-context-demo", "Star analysis"), comparison, total);
    const body = element("div", "trending-context-body");
    body.setAttribute("aria-live", "polite");
    details.append(summary, body);
    container.append(details);
    const view = { name, container, details, comparison, total, body };
    details.addEventListener("toggle", () => {
      if (details.open) loadRepository(view);
    });
    return view;
  }

  async function loadRepository(view) {
    if (view.pending) return;
    view.pending = true;
    if (!view.report) view.body.textContent = "Loading GitHub star history…";
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "trending-context:repository", repo: view.name });
    } catch {
      result = { error: "unavailable" };
    } finally {
      view.pending = false;
    }

    if (view !== repositoryView) return;
    const report = result?.repository;
    const message = result?.error === "rate_limited"
      ? "GitHub API rate limit reached. Try again later."
      : "GitHub star history is unavailable right now.";
    view.report = report;
    view.body.replaceChildren();
    view.comparison.hidden = !report;
    if (report) {
      const prefix = report.spike.status === "found" ? "Spike on " : "";
      view.comparison.textContent = prefix + comparisonSummary(report.spike);
      appendHistory(view.body, report.dailyStars, report.spike);
      view.body.append(element("p", "trending-context-note",
        "Compared through " + report.analysisThrough + " · Checked " + timestamp.format(report.collectedAt)));
    }
    if (!report || result.stale) {
      view.body.append(element("p", "trending-context-note", (report ? "Showing saved history. " : "") + message));
    }
  }

  function syncRepository(url) {
    const name = publicRepository(url);
    const anchor = name && (
      document.querySelector("main#js-repo-pjax-container #repo-content-pjax-container")
      ?? document.querySelector("main#ui-service-main-content")
    );
    if (!anchor || repositoryView?.name !== name) {
      repositoryView?.container.remove();
      repositoryView = undefined;
    }
    if (!anchor) return;
    repositoryView ??= createRepositoryView(name);
    const { container, total } = repositoryView;
    if (container.parentElement !== anchor) anchor.prepend(container);
    const count = displayedStarCount(name);
    const label = count && count + " total stars";
    if (total.textContent !== label) total.textContent = label;
    total.hidden = !count;
  }

  function sync() {
    frame = undefined;
    const url = new URL(location.href);
    const period = trendingPeriod(url);
    const periodChanged = renderedPeriod !== period;
    if (periodChanged) {
      document.querySelectorAll(selector).forEach(node => node.remove());
      renderedPeriod = period;
    }
    syncRepository(url);
    if (!period) return;

    const rows = rowsInView();
    if (!rows.length) return;
    const data = dataByPeriod.get(period);
    if (periodChanged || !data) loadPeriod(period);
    if (!data) return;

    const allowedRows = new Set(rows.map(({ row }) => row));
    for (const panel of document.querySelectorAll(selector)) {
      if (!allowedRows.has(panel.closest("article"))) panel.remove();
    }

    const entries = data.snapshot && indexRepositories(data.snapshot.repos);
    rows.forEach(({ row, name }, index) => {
      if (data.unavailable) {
        if (index === 0) {
          insert(row, "error", () => notice("Trending Context · Data could not be loaded", "error"));
        } else {
          row.querySelector(selector)?.remove();
        }
        return;
      }
      const entry = data.demo ? data.demo[index] : entries.get(name);
      const revision = data.demo ? "demo:" + index : [data.snapshot.generatedAt, data.stale, data.fallback].join(":");
      const key = period + ":" + name + ":" + revision;
      if (entry) {
        insert(row, key, () => panel(entry, key, data));
      } else if (data.demo) {
        row.querySelector(selector)?.remove();
      } else {
        insert(row, key + ":missing", () => notice(
          "Trending Context · Not in the last snapshot", key + ":missing", data.snapshot.trendingFetchedAt));
      }
    });
  }

  function schedule() {
    if (frame === undefined) frame = requestAnimationFrame(sync);
  }

  function refreshVisiblePeriod() {
    if (document.hidden) return;
    const period = trendingPeriod(new URL(location.href));
    if (period && rowsInView().length) loadPeriod(period);
  }

  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true });
  addEventListener("popstate", schedule);
  document.addEventListener("turbo:load", schedule);
  document.addEventListener("visibilitychange", refreshVisiblePeriod);
  setInterval(refreshVisiblePeriod, refreshInterval);
  schedule();
})();
