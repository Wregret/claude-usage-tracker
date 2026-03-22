# Claude Usage Tracker

A Chrome extension that tracks your [claude.ai](https://claude.ai) usage with session durations, message counts, and visual analytics.

## Features

- **Session Tracking** — Automatically tracks when you're using Claude, including session duration and message counts (user + assistant).
- **Daily & Weekly Summaries** — See your total usage time, message count, and session count at a glance.
- **Analytics Dashboard** — Interactive charts powered by Chart.js:
  - Daily usage trend (hours + messages) as a line chart
  - Messages by day of week (bar chart)
  - Activity by hour of day (bar chart)
- **Quick Stats** — Most active day, peak usage hour, and average session duration.
- **Session History** — Browse past sessions grouped by date with duration and message counts.
- **Automatic Idle Detection** — Sessions are finalized after 5 minutes of inactivity.
- **Data Retention** — Stores up to 90 days of history locally (no data leaves your browser).

## Screenshots

The popup has three tabs:

| Dashboard | Sessions | Analytics |
|-----------|----------|-----------|
| Live session, today/week stats, quick stats | Scrollable session history by date | Line & bar charts for usage trends |

---

## How to Install

### From Source (Developer Mode)

1. **Download or clone** this repository:
   ```bash
   git clone https://github.com/your-username/claude-usage-tracker.git
   ```

2. **Open Chrome** and navigate to:
   ```
   chrome://extensions/
   ```

3. **Enable Developer Mode** — toggle the switch in the top-right corner.

4. **Click "Load unpacked"** — select the `claude-usage-tracker` folder (the one containing `manifest.json`).

5. **Done!** You should see the Claude Usage Tracker icon in your toolbar. Pin it for easy access.

### Verifying Installation

1. Click the extension icon — you should see "No active session" on the Dashboard.
2. Open [claude.ai](https://claude.ai) in a tab.
3. Click the extension icon again — the Dashboard should now show a live session timer.

---

## How to Use

### Dashboard Tab
- Shows your **current session** with a live duration counter and message count.
- **Today** card: cumulative time, messages, and sessions for today.
- **This Week** card: same metrics for the current week (Monday–Sunday).
- **Quick Stats**: most active day of week, peak hour, and average session duration.

### Sessions Tab
- Lists all recorded sessions, grouped by date (most recent first).
- Each session shows: start time, duration, and message count.
- Sessions shorter than 10 seconds are discarded (accidental page visits).

### Analytics Tab
- **Date range selector**: "7 Days", "30 Days", or "All Time".
- **Daily Usage chart** (line): shows hours spent and messages per day on dual axes.
- **Messages by Day of Week** (bar): which days you use Claude the most.
- **Activity by Hour** (bar): your usage pattern across 24 hours.

### How It Works

The extension runs a **content script** on claude.ai pages that:
- Detects when new messages appear in the chat (via DOM observation).
- Sends heartbeats every 30 seconds to keep the session alive.

A **background service worker** manages session lifecycle:
- Starts a session when you visit claude.ai.
- Ends the session when you close the tab or are idle for 5+ minutes.
- Stores all data in `chrome.storage.local` (never leaves your browser).

---

## How to Uninstall

1. Go to `chrome://extensions/`.
2. Find **Claude Usage Tracker**.
3. Click **Remove** and confirm.

This deletes the extension and all stored usage data.

### Export Data Before Uninstalling

If you want to save your data before uninstalling:

1. Go to `chrome://extensions/` and find Claude Usage Tracker.
2. Click **"Service Worker"** (under "Inspect views") to open DevTools.
3. In the Console, run:
   ```js
   chrome.storage.local.get(null, data => console.log(JSON.stringify(data, null, 2)));
   ```
4. Copy the output and save it to a file.

---

## Privacy

- All data is stored **locally** in Chrome's storage (`chrome.storage.local`).
- **No data is sent to any server.** The extension has no network permissions.
- The extension only activates on `https://claude.ai/*` pages.
- Data is automatically pruned after 90 days.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No session detected | Make sure you're on `https://claude.ai` (not a different domain). Reload the page. |
| Message count seems off | Claude.ai may update its DOM structure. The extension uses multiple heuristics to detect messages; it may under-count if the site changes significantly. |
| Extension stopped working after Chrome update | Go to `chrome://extensions/`, disable and re-enable the extension. |
| Data not showing in charts | Use Claude for a day or two to accumulate data. Charts need at least a few data points. |

---

## License

MIT
