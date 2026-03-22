# Claude Usage Tracker

A Chrome extension that shows your **claude.ai usage limits** at a glance — the same info from `claude.ai/settings/usage`, accessible with one click from your toolbar.

## Features

- **Usage Percentage Bar** — See how much of your limit you've consumed, color-coded green/yellow/red.
- **Plan Info** — Shows your current plan (Free, Pro, Team, etc.).
- **Rate Limit Status** — Remaining messages, reset times.
- **Auto-Refresh** — Data refreshes every 5 minutes while a claude.ai tab is open.
- **Manual Refresh** — Click the refresh button anytime.
- **Usage History Chart** — Track your daily usage percentage over time.
- **Raw Details** — Collapsible section showing the full API response data.
- **Privacy** — All data stays local. No external network requests.

## How It Works

The extension runs a content script on claude.ai that:
1. **Discovers your organization ID** by intercepting API calls (every claude.ai API URL contains it).
2. **Fetches usage data** from claude.ai's internal API endpoints (same ones the settings page uses).
3. **Sends the data to the popup** for display.

Because the content script runs in the page context, your session cookies are automatically included — no separate login needed.

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

1. Open [claude.ai](https://claude.ai) in a tab (you must be logged in).
2. Click the extension icon — your usage data should appear within a few seconds.
3. If you see an error, try sending a message on claude.ai first (this helps the extension discover your organization ID), then click the refresh button.

---

## How to Use

- **Click the icon** to see your current usage.
- **Refresh button** (&#x21bb;) fetches fresh data from claude.ai.
- **Status bar** shows when data was last updated.
- **Usage bars** show your consumption with color coding:
  - Green: under 70%
  - Yellow: 70-90%
  - Red: over 90%
- **Rate Limits** section shows reset times and other details.
- **Details** section (click to expand) shows the raw API response — useful for debugging or seeing exact numbers.
- **Usage History** chart appears after a few days of data, showing your daily usage trend.

---

## How to Uninstall

1. Go to `chrome://extensions/`
2. Find **Claude Usage Tracker** → click **Remove**.

---

## Privacy

- All data stored locally in `chrome.storage.local`.
- The extension only communicates with `claude.ai` (same-origin API calls via the content script).
- No data is sent to any third-party server.
- No external scripts loaded.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No claude.ai tab open" | Open claude.ai in a tab and make sure you're logged in. |
| "Could not find organization ID" | Send at least one message on claude.ai, then click refresh. The extension discovers your org ID from API calls. |
| Extension won't load | Remove it from `chrome://extensions/` completely, then "Load unpacked" again. Chrome caches old service workers. |
| No usage bars showing | The extension tries multiple API endpoints. If claude.ai changed their API, check the Details section for raw data, or file an issue. |
| Data seems stale | Click the refresh button. Data auto-refreshes every 5 minutes. |

---

## License

MIT
