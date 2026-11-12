(() => {
  const { snapshotFiles, validSnapshot, isStale } = globalThis.TrendingContext;
  const periods = [...document.querySelectorAll("[data-period]")];
  const workspace = document.querySelector("#workspace");
  const loading = document.querySelector("#loading");
  const message = document.querySelector("#load-message");
  const retry = document.querySelector("#retry");
  const snapshotTime = document.querySelector("#snapshot-time");
  const ranking = document.querySelector("#repository-list");
  const picker = document.querySelector("#repository-select");
  const detail = document.querySelector("#repository-detail");
  const snapshots = new Map();
  const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
  const number = new Intl.NumberFormat("en");
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const sources = { releases: "GitHub release", hn: "Hacker News" };
  const states = {
    found: "Spike detected",
    no_spike: "No spike detected",
    insufficient: "Limited history",
    unavailable: "History unavailable",
  };
  let currentSnapshot;
  let currentRepository;
  let navigation = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function dateLabel(value) {
    return date.format(new Date(value));
  }

  function starLabel(count) {
    if (count === null) return "Star count unavailable";
    return number.format(count) + (count === 1 ? " star" : " stars");
  }

  function plotChart(days, spike, analysisThrough) {
    const section = element("figure", "chart");
    const caption = element("figcaption");
    const readout = element("span", "chart-readout");
    caption.append(element("h3", "", "Daily stars"), readout);
    section.append(caption);
    if (!days.some(day => day.stars !== null)) {
      section.append(element("p", "empty-note", "GitHub has no daily counts in this snapshot."));
      return section;
    }

    const area = element("div", "chart-area");
    const ticks = element("ul", "y-axis");
    const plot = element("div", "plot");
    const grid = element("div", "grid");
    ticks.setAttribute("aria-hidden", "true");
    const max = Math.max(1, ...days.map(day => day.stars ?? 0));
    const magnitude = 10 ** Math.floor(Math.log10(max / 4));
    const step = Math.max(1, Math.ceil(max / (4 * magnitude)) * magnitude);
    const ceiling = step * 4;
    for (let row = 4; row >= 0; row--) {
      ticks.append(element("li", "", compact.format(step * row)));
      grid.append(element("span"));
    }
    const list = element("ol", "bars");
    list.style.setProperty("--days", days.length);
    list.setAttribute("aria-label", "Daily star counts");
    let selected = days.findIndex(day => day.date === spike.date);
    if (selected < 0) selected = days.findLastIndex(day => day.stars !== null);

    function preview(index) {
      const day = days[index];
      readout.textContent = dateLabel(day.date) + " · " + starLabel(day.stars);
    }

    const buttons = days.map(({ date, stars }, index) => {
      const button = element("button", "bar-button");
      button.type = "button";
      button.tabIndex = index === selected ? 0 : -1;
      button.setAttribute("aria-pressed", String(index === selected));
      button.classList.toggle("is-peak", date === spike.date);
      button.classList.toggle("is-missing", stars === null);
      const label = dateLabel(date) + ", " + starLabel(stars) + (date === spike.date ? ", spike" : "");
      button.setAttribute("aria-label", label);
      button.title = label;
      const bar = element("span");
      bar.style.setProperty("--height", ((stars ?? 0) / ceiling * 100) + "%");
      button.append(bar);
      button.addEventListener("pointerenter", () => preview(index));
      button.addEventListener("focus", () => preview(index));
      button.addEventListener("click", () => selectDay(index));
      button.addEventListener("keydown", event => {
        const next = event.key === "ArrowLeft" ? index - 1 : event.key === "ArrowRight" ? index + 1 : null;
        if (next === null) return;
        event.preventDefault();
        const target = Math.min(Math.max(next, 0), days.length - 1);
        selectDay(target);
        buttons[target].focus();
      });
      const item = element("li");
      item.append(button);
      list.append(item);
      return button;
    });

    function selectDay(index) {
      buttons[selected].tabIndex = -1;
      buttons[selected].setAttribute("aria-pressed", "false");
      selected = index;
      buttons[index].tabIndex = 0;
      buttons[index].setAttribute("aria-pressed", "true");
      preview(index);
    }

    list.addEventListener("pointerleave", () => preview(selected));
    list.addEventListener("focusout", () => preview(selected));
    preview(selected);
    plot.append(grid, list);
    const labels = element("div", "x-axis");
    labels.append(element("span", "", dateLabel(days[0].date)));
    if (days.length > 1) labels.append(element("span", "", dateLabel(days.at(-1).date)));
    area.append(ticks, plot, labels);
    const note = "Compared through " + dateLabel(analysisThrough) + " (UTC).";
    section.append(area, element("p", "chart-note", note + (days.some(day => day.stars === null) ? " Dashed marks indicate missing data." : "")));
    return section;
  }

  function relatedActivity(entry) {
    const section = element("section", "sources");
    section.append(element("h3", "", "Related activity"));
    if (entry.spike.status !== "found") {
      const reason = entry.spike.status === "no_spike"
        ? "No qualifying spike in this chart."
        : "A spike could not be confirmed from the available data.";
      section.append(element("p", "empty-note", reason));
      return section;
    }

    const events = Object.keys(sources).flatMap(source =>
      entry.sources[source].items.map(event => ({ ...event, source })),
    ).sort((left, right) => left.date.localeCompare(right.date));
    const window = "Public releases and posts checked within one day of " + dateLabel(entry.spike.date) + ".";
    section.append(element("p", "empty-note", window));
    if (events.length) {
      const list = element("ul");
      for (const event of events) {
        const row = element("li", "evidence-row");
        const when = element("time", "", dateLabel(event.date));
        when.dateTime = event.date;
        const link = element("a", "", event.title);
        link.href = event.url;
        row.append(when, link, element("span", "source-name", sources[event.source]));
        list.append(row);
      }
      section.append(list);
    }
    const statuses = Object.entries(entry.sources).flatMap(([source, { status }]) => {
      const label = source === "releases" ? "GitHub releases" : "Hacker News posts";
      if (status === "none_found") return [element("span", "", "No matching " + label)];
      if (status === "unavailable") return [element("span", "", label + " unavailable")];
      return [];
    });
    if (statuses.length) {
      const status = element("div", "source-status");
      status.append(...statuses);
      section.append(status);
    }
    return section;
  }

  function renderDetails(entry, snapshot) {
    const header = element("div", "detail-head");
    const title = element("h2");
    const [owner, repo] = entry.fullName.split("/");
    const github = element("a");
    github.href = "https://github.com/" + entry.fullName;
    github.append(element("span", "repo-owner", owner + " / "), document.createTextNode(repo));
    title.append(github);
    const spike = entry.spike;
    const badge = element("span", "detail-status", states[spike.status]);
    badge.classList.toggle("is-spike", spike.status === "found");
    header.append(title, badge);
    detail.replaceChildren(header);
    if (spike.status === "found") {
      detail.append(element("p", "summary-line",
        "+" + starLabel(spike.stars) + " on " + dateLabel(spike.date) + " · 7-day median " + starLabel(spike.baseline)));
    }
    detail.append(plotChart(entry.dailyStars, spike, snapshot.analysisThrough), relatedActivity(entry));
  }

  function renderRanking(snapshot) {
    ranking.replaceChildren();
    picker.replaceChildren();
    for (const entry of snapshot.repos) {
      const row = element("li");
      const button = element("button", "repo-button");
      button.type = "button";
      button.dataset.repo = entry.fullName;
      button.setAttribute("aria-pressed", "false");
      const label = element("span");
      const state = element("span", "repo-state", states[entry.spike.status]);
      state.classList.toggle("is-spike", entry.spike.status === "found");
      label.append(element("span", "repo-title", entry.fullName), state);
      button.append(element("span", "rank", String(entry.rank).padStart(2, "0")), label);
      button.addEventListener("click", () => navigate(snapshot.period ?? "daily", entry.fullName));
      row.append(button);
      ranking.append(row);
      const option = element("option", "", entry.rank + ". " + entry.fullName);
      option.value = entry.fullName;
      picker.append(option);
    }
  }

  function route() {
    const query = new URLSearchParams(location.search);
    const since = query.get("since");
    return {
      period: Object.hasOwn(snapshotFiles, since) ? since : "daily",
      repo: query.get("repo")?.toLowerCase(),
    };
  }

  function navigate(period, repo) {
    const url = new URL(location.href);
    if (period === "daily") url.searchParams.delete("since");
    else url.searchParams.set("since", period);
    if (repo) url.searchParams.set("repo", repo);
    else url.searchParams.delete("repo");
    if (url.href !== location.href) history.pushState(null, "", url);
    renderRoute();
  }

  function readSnapshot(period) {
    if (!snapshots.has(period)) {
      const promise = fetch("./" + snapshotFiles[period], { signal: AbortSignal.timeout(10000) })
        .then(response => {
          if (!response.ok) throw new Error("Snapshot HTTP " + response.status);
          return response.json();
        })
        .then(snapshot => {
          if (!validSnapshot(snapshot, period)) throw new Error("Unexpected snapshot data");
          return snapshot;
        })
        .catch(error => {
          snapshots.delete(period);
          throw error;
        });
      snapshots.set(period, promise);
    }
    return snapshots.get(period);
  }

  async function renderRoute() {
    const request = ++navigation;
    const { period, repo } = route();
    for (const button of periods) button.setAttribute("aria-pressed", String(button.dataset.period === period));
    retry.hidden = true;
    if ((currentSnapshot?.period ?? (currentSnapshot ? "daily" : null)) !== period) {
      workspace.hidden = true;
      loading.hidden = false;
      snapshotTime.textContent = "";
      message.textContent = "Loading GitHub Trending…";
    }
    try {
      const snapshot = await readSnapshot(period);
      if (request !== navigation) return;
      if (snapshot !== currentSnapshot) renderRanking(snapshot);
      const entry = snapshot.repos.find(item => item.fullName.toLowerCase() === repo) ?? snapshot.repos[0];
      if (entry !== currentRepository) renderDetails(entry, snapshot);
      for (const button of ranking.querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(button.dataset.repo === entry.fullName));
      }
      picker.value = entry.fullName;
      currentSnapshot = snapshot;
      currentRepository = entry;
      snapshotTime.textContent = (isStale(snapshot) ? "Older snapshot · " : "Collected ")
        + time.format(new Date(snapshot.trendingFetchedAt));
      loading.hidden = true;
      workspace.hidden = false;
    } catch {
      if (request !== navigation) return;
      workspace.hidden = true;
      loading.hidden = false;
      message.textContent = "This Trending snapshot could not be loaded.";
      retry.hidden = false;
    }
  }

  for (const button of periods) button.addEventListener("click", () => navigate(button.dataset.period));
  picker.addEventListener("change", () => navigate(route().period, picker.value));
  retry.addEventListener("click", renderRoute);
  addEventListener("popstate", renderRoute);
  renderRoute();
})();
