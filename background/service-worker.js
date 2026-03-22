/**
 * Background service worker for Claude Usage Tracker.
 *
 * Manages session lifecycle:
 * - Starts sessions when user navigates to claude.ai
 * - Tracks message counts via content script messages
 * - Ends sessions on tab close, navigation away, or idle timeout
 * - Uses chrome.alarms for periodic session liveness checks
 */

// Import shared utilities (service worker supports importScripts)
importScripts('../utils/time.js', '../lib/storage.js');

/** Idle timeout: finalize session after 5 minutes of no activity */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Alarm name for periodic session liveness check */
const SESSION_CHECK_ALARM = 'sessionCheck';

// ─── Initialization ──────────────────────────────────────────

// Set up periodic alarm for session liveness checks (every 1 minute)
chrome.alarms.create(SESSION_CHECK_ALARM, { periodInMinutes: 1 });

// Run data pruning on startup (keep last 90 days)
Storage.pruneOldData(90);

// ─── Tab Event Listeners ─────────────────────────────────────

/**
 * When a tab finishes loading, check if it's a claude.ai page
 * and start a session if needed.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (tab.url && tab.url.startsWith('https://claude.ai')) {
    await ensureSessionStarted();
  }
});

/**
 * When the user switches to a tab, check if it's a claude.ai tab.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url.startsWith('https://claude.ai')) {
      await ensureSessionStarted();
    }
  } catch (e) {
    // Tab may have been closed already
  }
});

/**
 * When a tab is closed, check if any claude.ai tabs remain.
 * If none remain, finalize the active session.
 */
chrome.tabs.onRemoved.addListener(async () => {
  const hasClaudeTab = await checkForClaudeTabs();
  if (!hasClaudeTab) {
    await finalizeSession();
  }
});

// ─── Message Listener (from content script) ──────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep message channel open for async response
});

/**
 * Handle messages from the content script.
 * Supports MESSAGE_DETECTED (new chat message) and HEARTBEAT.
 * @param {Object} message - Message from content script
 */
async function handleMessage(message) {
  const session = await Storage.getActiveSession();
  if (!session) {
    // No active session — start one (content script is on claude.ai)
    await ensureSessionStarted();
    return { ok: true };
  }

  const now = Date.now();

  if (message.type === 'MESSAGE_DETECTED') {
    // Increment message counters based on role
    session.messageCount += 1;
    if (message.role === 'user') {
      session.userMessages += 1;
    } else if (message.role === 'assistant') {
      session.assistantMessages += 1;
    }
    session.lastActivity = now;
    await Storage.setActiveSession(session);

    // Update hourly aggregate for the message
    const hour = getHourOfDay(now);
    await Storage.incrementHourlyAggregate(hour, 1);

  } else if (message.type === 'HEARTBEAT') {
    // Update last activity time to keep session alive
    session.lastActivity = now;
    await Storage.setActiveSession(session);
  }

  return { ok: true };
}

// ─── Alarm Listener ──────────────────────────────────────────

/**
 * Periodic check: if the active session has been idle too long,
 * finalize it. This guards against the content script stopping
 * (e.g., tab backgrounded, page navigated).
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SESSION_CHECK_ALARM) return;

  const session = await Storage.getActiveSession();
  if (!session) return;

  const now = Date.now();
  const idleTime = now - session.lastActivity;

  if (idleTime > IDLE_TIMEOUT_MS) {
    // Session is idle — finalize it with lastActivity as end time
    await finalizeSession(session.lastActivity);
  }
});

// ─── Session Lifecycle ───────────────────────────────────────

/**
 * Start a new session if one isn't already active.
 * Creates a session object and stores it.
 */
async function ensureSessionStarted() {
  const existing = await Storage.getActiveSession();
  if (existing) return; // Already tracking

  const now = Date.now();
  const session = {
    id: `sess_${now}`,
    startTime: now,
    messageCount: 0,
    userMessages: 0,
    assistantMessages: 0,
    lastActivity: now
  };

  await Storage.setActiveSession(session);

  // Track hourly session start
  const hour = getHourOfDay(now);
  await Storage.incrementHourlySession(hour);
}

/**
 * Finalize the active session: compute duration, save to history,
 * update aggregates, and clear the active session.
 * @param {number} [endTime] - Override end time (defaults to now)
 */
async function finalizeSession(endTime) {
  const session = await Storage.getActiveSession();
  if (!session) return;

  const end = endTime || Date.now();
  const duration = end - session.startTime;

  // Don't save sessions shorter than 10 seconds (accidental visits)
  if (duration < 10000) {
    await Storage.clearActiveSession();
    return;
  }

  // Build completed session record
  const completedSession = {
    id: session.id,
    startTime: session.startTime,
    endTime: end,
    duration: duration,
    messageCount: session.messageCount,
    userMessages: session.userMessages,
    assistantMessages: session.assistantMessages,
    date: getDateString(session.startTime),
    hourOfDay: getHourOfDay(session.startTime)
  };

  // Save session and update aggregates
  await Storage.saveSession(completedSession);
  await Storage.updateDailyAggregate(completedSession.date, {
    duration: duration,
    messages: session.messageCount,
    sessions: 1
  });

  // Update day-of-week aggregate
  const dayIndex = getDayOfWeek(session.startTime);
  await Storage.incrementDayOfWeekAggregate(dayIndex, {
    duration: duration,
    messages: session.messageCount
  });

  // Clear the active session
  await Storage.clearActiveSession();
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Check if any open tabs are on claude.ai.
 * @returns {Promise<boolean>} True if at least one claude.ai tab exists
 */
async function checkForClaudeTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  return tabs.length > 0;
}
