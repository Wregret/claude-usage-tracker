# Claude Usage Tracker

A Chrome extension that shows your **claude.ai chat usage** and **Anthropic API usage** at a glance — no need to visit settings pages.

## Features

- **Chat Usage Tab** — 5-hour and 7-day utilization bars from claude.ai, color-coded green/yellow/red.
- **API Usage Tab** — Token usage, per-model breakdown, rate limits, and workspace/key filtering from platform.claude.com.
- **Plan Info** — Shows your current plan (Free, Pro, Team, etc.).
- **Auto-Refresh** — Data refreshes every 5 minutes while relevant tabs are open.
- **Manual Refresh** — Click the refresh button anytime.
- **Usage History Charts** — Track daily usage trends over time (separate for chat and API).
- **Raw Details** — Collapsible section showing the full API response data.
- **Privacy** — All data stays local. No external network requests.

## How It Works

The extension runs content scripts on two sites:

**Chat usage** (claude.ai):
1. Discovers your organization ID by fetching the organizations API.
2. Fetches usage data from claude.ai's internal API endpoints.

**API usage** (platform.claude.com):
1. Discovers your API organization (selects the org with `api` capability).
2. Fetches token usage, per-model breakdown, and rate limits for the current month.

Both use your existing session cookies — no API keys or separate login needed.

---

## How to Install

1. **Clone** this repository:
   ```bash
   git clone https://github.com/Wregret/claude-usage-tracker.git
   ```

2. Open Chrome → `chrome://extensions/`

3. Enable **Developer Mode** (top-right toggle).

4. Click **"Load unpacked"** → select the `claude-usage-tracker` folder.

5. **Pin** the extension icon for quick access.

### First Use

1. Open [claude.ai](https://claude.ai) in a tab (you must be logged in) for chat usage.
2. Open [platform.claude.com](https://platform.claude.com) in a tab (logged in) for API usage.
3. Click the extension icon — switch between **Chat** and **API** tabs.
4. If you see an error, try refreshing the relevant page, then click the refresh button.

---

## How to Use

- **Click the icon** to see your current usage.
- **Refresh button** (&#x21bb;) fetches fresh data.
- **Status bar** shows when data was last updated.
- **Chat tab** — usage bars with color coding (green < 70%, yellow 70-90%, red > 90%).
- **API tab** — monthly token counts (input/output/cache), per-model breakdown, rate limits per model group.
- **Filter dropdowns** (API tab) — filter usage by workspace or API key.
- **Details** section (click to expand) shows the raw API response — useful for debugging or seeing exact numbers.
- **Usage History** chart appears after a few days of data, showing your daily usage trend.

---

## How to Uninstall

1. Go to `chrome://extensions/`
2. Find **Claude Usage Tracker** → click **Remove**.

---

## Privacy

- All data stored locally in `chrome.storage.local`.
- The extension only communicates with `claude.ai` and `platform.claude.com` (same-origin API calls via content scripts).
- No data is sent to any third-party server.
- No external scripts loaded.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No claude.ai tab open" | Open claude.ai in a tab and make sure you're logged in. |
| "No platform.claude.com tab open" | Open platform.claude.com in a tab and make sure you're logged in. |
| "Could not find organization ID" | Send at least one message on claude.ai, then click refresh. The extension discovers your org ID from API calls. |
| Extension won't load | Remove it from `chrome://extensions/` completely, then "Load unpacked" again. Chrome caches old service workers. |
| No usage bars showing | The extension tries multiple API endpoints. If claude.ai changed their API, check the Details section for raw data, or file an issue. |
| API tab shows no data | Make sure you've made at least one API call this month. Usage data can take up to 5 minutes to appear. |
| Data seems stale | Click the refresh button. Data auto-refreshes every 5 minutes. |

---

## License

MIT
