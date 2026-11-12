(() => {
  const { repositoryName, isDailyTrending, indexRepositories } = globalThis.TrendingContext;
  const selector = ".trending-context";
  const numbers = new Intl.NumberFormat("en");
  const timestamp = new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  const sourceNames = { hn: "Hacker News", releases: "Releases" };
  let data;
  let pending;
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

  function panel(entry, key) {
    const { dailyStars, sources } = entry;
    const spike = data.demo && entry.spike ? { status: "found", ...entry.spike } : entry.spike;
    const details = element("details", "trending-context");
    details.dataset.contextKey = key;
    const summary = element("summary");
    summary.append(element("span", "trending-context-demo", data.demo ? "Example data" : "Trending Context"));
    summary.append(element("span", "", comparisonSummary(spike)));
    if (spike?.status === "found") {
      summary.append(element("span", "trending-context-muted", sourceSummary(sources)));
    }
    if (data.stale || data.fallback) {
      summary.append(element("span", "trending-context-muted", data.stale ? "Older snapshot" : "Saved snapshot"));
    }
    details.append(summary);

    const body = element("div", "trending-context-body");
    if (dailyStars.length) {
      body.append(element("p", "trending-context-label", "Daily stars"));
      body.append(historyChart(dailyStars, spike?.date));
      const dates = element("div", "trending-context-dates");
      dates.append(element("span", "", shortDate(dailyStars[0].date)), element("span", "", shortDate(dailyStars.at(-1).date)));
      body.append(dates);
    }
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
    current?.remove();
    const anchor = row.querySelector(":scope > p:not(.trending-context)") ?? row.querySelector("h2");
    anchor.after(render());
  }

  function sync() {
    frame = undefined;
    if (!isDailyTrending(new URL(location.href))) {
      document.querySelectorAll(selector).forEach(node => node.remove());
      return;
    }

    const rows = rowsInView();
    if (!rows.length) return;
    if (!data) {
      pending ??= chrome.runtime.sendMessage({ type: "trending-context:snapshot" })
        .then(result => { data = result ?? { unavailable: true }; })
        .catch(() => { data = { unavailable: true }; })
        .finally(() => { pending = undefined; schedule(); });
      return;
    }

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
      const key = name + (data.demo ? ":demo:" + index : ":" + data.snapshot.generatedAt);
      if (entry) {
        insert(row, key, () => panel(entry, key));
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

  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true });
  addEventListener("popstate", schedule);
  document.addEventListener("turbo:load", schedule);
  schedule();
})();
