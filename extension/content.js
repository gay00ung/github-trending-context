(() => {
  const { repositoryName, isDailyTrending } = globalThis.TrendingContext;
  const selector = ".trending-context";
  const numbers = new Intl.NumberFormat("en");
  let snapshot;
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

  function evidenceLink(event) {
    const item = element("li");
    const link = element("a", "", event.title);
    link.href = event.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(element("time", "", shortDate(event.date)), link);
    item.firstChild.dateTime = event.date;
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

  function panel(entry) {
    const { dailyStars, spike, sources } = entry;
    const events = [...sources.hn.items, ...sources.releases.items];
    const details = element("details", "trending-context");
    const summary = element("summary");
    summary.append(element("span", "trending-context-demo", "Example data"));
    summary.append(element("span", "", spike
      ? shortDate(spike.date) + " · " + stars(spike.stars) + " ★ · 7-day median " + stars(spike.baseline)
      : "Star history"));
    if (events.length) summary.append(element("span", "trending-context-muted", events.length + " related events"));
    details.append(summary);

    const body = element("div", "trending-context-body");
    if (dailyStars.length) {
      body.append(element("p", "trending-context-label", "Daily stars"));
      body.append(historyChart(dailyStars, spike?.date));
      const dates = element("div", "trending-context-dates");
      dates.append(element("span", "", shortDate(dailyStars[0].date)), element("span", "", shortDate(dailyStars.at(-1).date)));
      body.append(dates);
    }
    if (events.length) {
      const list = element("ul", "trending-context-evidence");
      list.append(...events.map(evidenceLink));
      body.append(element("p", "trending-context-label", "Example source links"), list);
    } else {
      body.append(element("p", "trending-context-muted", "No related events in this example."));
    }
    details.append(body);
    return details;
  }

  function sync() {
    frame = undefined;
    if (!isDailyTrending(new URL(location.href))) {
      document.querySelectorAll(selector).forEach(node => node.remove());
      return;
    }

    const rows = [...document.querySelectorAll("main article.Box-row")].filter(row => {
      const link = row.querySelector("h2 a");
      return link && repositoryName(new URL(link.href).pathname);
    });
    if (!rows.length) return;
    if (!snapshot) {
      snapshot = fetch(chrome.runtime.getURL("fixtures/demo.json"))
        .then(response => response.json())
        .then(data => { snapshot = data; schedule(); })
        .catch(() => { snapshot = []; });
    }
    if (!Array.isArray(snapshot)) return;

    rows.forEach((row, index) => {
      const entry = snapshot[index];
      const current = row.querySelector(selector);
      if (!entry) {
        current?.remove();
      } else if (!current) {
        const description = row.querySelector(":scope > p");
        (description ?? row.querySelector("h2")).after(panel(entry));
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
