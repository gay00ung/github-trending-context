<h1 align="center">Trending Context</h1>

<p align="center">
  See when stars jumped and what happened around that date, directly in GitHub Trending.
</p>

<p align="center">
  <a href="https://github.com/gay00ung/github-trending-context/actions/workflows/checks.yml"><img alt="Checks" src="https://github.com/gay00ung/github-trending-context/actions/workflows/checks.yml/badge.svg"></a>
  <a href="https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3"><img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&amp;logoColor=white"></a>
  <a href="https://www.python.org/"><img alt="Python 3.12+" src="https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&amp;logoColor=white"></a>
  <a href="https://developer.mozilla.org/docs/Web/JavaScript"><img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&amp;logoColor=222222"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-22863a"></a>
</p>

<p align="center"><a href="https://gay00ung.github.io/github-trending-context/"><strong>Try the live web demo</strong></a> · <a href="#try-it-locally">Install in Chrome</a> · <a href="#what-the-data-means">Methodology</a></p>

<p align="center">
  <img src="docs/media/demo.gif" alt="The Trending Context panel expands on GitHub Trending, then the fictional repository opens and the Star analysis panel reveals its daily star chart." width="920">
</p>

The demo uses fictional repository names and source links. It follows a repository from GitHub Trending to its home page and opens **Star analysis**. [View the expanded Trending panel as a still image](docs/media/expanded.png).

## What you see

- A summary below each repository description in the top 10 for Today, This week, or This month with all languages selected. GitHub controls the list and its order.
- A **Star analysis** panel on public repository home pages. It shows the total from the GitHub page and loads up to 14 days of daily counts and the latest matching spike when you expand it.
- A 14-day star chart with the most recent comparable spike highlighted, plus links to matching Hacker News posts and releases.
- A collection timestamp and separate states for missing history, unavailable sources, and snapshots that are over 36 hours old.

## Try it locally

The [live web demo](https://gay00ung.github.io/github-trending-context/) lets you switch between all three Trending periods and explore the same charts and related links in any browser.

To install in Chrome, download and unzip the Chrome extension ZIP from [GitHub Releases](https://github.com/gay00ung/github-trending-context/releases/latest). Open `chrome://extensions`, turn on **Developer mode**, then choose **Load unpacked** and select the unzipped folder. The extension reads the daily Trending snapshots from GitHub Pages.

### Build from source

You need Chrome and Python 3.12 or later. The collector uses the Python standard library and public endpoints.

```sh
git clone https://github.com/gay00ung/github-trending-context.git
cd github-trending-context
python3 -m collector --period all
python3 scripts/package_extension.py \
  --snapshot-dir build/site \
  --output build/trending-context-local
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select `build/trending-context-local`.
3. Open [GitHub Trending](https://github.com/trending) with the language filters cleared and choose **Today**, **This week**, or **This month**. Select a **Trending Context** summary to see its evidence.
4. Open a public repository's home page and expand **Star analysis** above its code. The extension uses one request to GitHub's public star history API for each uncached chart. It stores recent charts in Chrome and reuses them until the next UTC analysis date. If GitHub limits a refresh, the panel can show saved history.

To refresh **Today**, **This week**, and **This month** in the installed local build, run:

```sh
python3 scripts/refresh_local.py build/trending-context-local
```

On macOS, add `--install-macos` to register a daily refresh at **09:17 in your Mac's time zone**. The job runs while you're signed in, even when Chrome is closed. It checks on sign-in and hourly for a missed or failed run. Chrome reads the new snapshots when you open or return to Trending, and every five minutes while the tab is visible. If collection fails, the last successful snapshots stay in place. The job's log is at `build/local-refresh/refresh.log`.

For authenticated collection, the refresh command uses `GITHUB_TOKEN` or an existing `gh auth login` for github.com. To try the interface without collecting data, run `python3 scripts/package_extension.py --demo --output build/trending-context-demo` and load that build.

## What the data means

| Signal | How it is collected |
| --- | --- |
| Trending position | Read in order from GitHub's public Trending page for the selected period at collection time. |
| Daily stars | GitHub's aggregate star history. The comparison ends two UTC calendar days before collection because the API does not guarantee UTC-aligned day boundaries. Missing days remain gaps. |
| Spike | At least 100 stars on a day, and at least five times the median of the preceding seven calendar days with data. With a median of zero, the 100-star threshold applies. The panel uses the most recent day that meets the rule. |
| Nearby public activity | Up to ten recent GitHub releases and the first twenty date-filtered Hacker News search results, checked within one calendar day on either side of the spike. A Hacker News result must link to the repository. |

The panel reports what was observed and when. A matching release or discussion can provide context for a spike. The available data cannot determine whether stars were purchased or where all visitors came from.

[GitHub star history](https://docs.github.com/en/rest/activity/starring#get-repository-star-history) · [GitHub releases](https://docs.github.com/en/rest/releases/releases#list-releases) · [Hacker News Search API](https://hn.algolia.com/api)

## Hosted snapshots

The source extension reads the selected period's snapshot from the project's GitHub Pages site when Pages is enabled. The **Refresh snapshot** workflow collects all three periods daily and supports manual runs. A failed collection leaves the last successful deployment available. The extension requests the same JSON per period for everyone, caches the last valid copy locally, and keeps browsing activity on the device.

For maintainers, enable **Settings → Pages → Source → GitHub Actions** in the public repository, then run **Refresh snapshot** from the Actions tab. The workflow publishes the demo and all three feeds and builds an unpacked extension artifact. To preview the site locally, run `python3 scripts/stage_pages.py --output build/site` after collecting the snapshots, then run `python3 -m http.server --directory build/site`.

## Development

JavaScript powers the Manifest V3 extension. Python handles collection and packaging. GitHub Actions runs the checks and publishes the static feed.

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/extension.test.cjs
```

Node.js is needed for the JavaScript tests. When reporting a UI issue, include the Trending URL and what the panel displayed. For a data issue, include the repository name and the collection timestamp shown in the expanded panel.

Distributed under the [MIT License](LICENSE).
