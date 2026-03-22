/**
 * Background service worker for Claude Usage Tracker.
 *
 * Self-contained (no importScripts).
 *
 * Responsibilities:
 * - Cache usage data received from the content script
 * - Relay FETCH_USAGE requests from popup to the content script
 * - Store org ID and usage snapshots in chrome.storage.local
 * - Periodically refresh usage data via alarm
 */

// ═══════════════════════════════════════════════════════════════
// Time Utilities (inlined)
// ═══════════════════════════════════════════════════════════════

function getDateString(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

/** Alarm to periodically refresh usage data */
const REFRESH_ALARM = 'refreshUsage';

/** Refresh interval: every 5 minutes */
const REFRESH_INTERVAL_MIN = 5;

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

// Set up periodic refresh alarm
chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MIN });

// ═══════════════════════════════════════════════════════════════
// Message Listener
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    // Content script discovered the org ID
    case 'ORG_ID_DISCOVERED':
      await chrome.storage.local.set({ orgId: message.orgId });
      return { ok: true };

    // Content script intercepted usage data from an API response
    case 'USAGE_DATA_INTERCEPTED':
      await cacheUsageData(message.url, message.data, message.timestamp);
      return { ok: true };

    // Popup requests fresh usage data
    case 'POPUP_FETCH_USAGE':
      return await fetchUsageViaContentScript();

    // Popup requests cached usage data (fast path)
    case 'POPUP_GET_CACHED':
      return await getCachedUsageData();

    // Popup requests usage history
    case 'POPUP_GET_HISTORY':
      return await getUsageHistory();

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

// ═══════════════════════════════════════════════════════════════
// Alarm: Periodic Refresh
// ═══════════════════════════════════════════════════════════════

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  // Try to refresh data if a claude.ai tab is open
  await fetchUsageViaContentScript();
});

// ═══════════════════════════════════════════════════════════════
// Data Management
// ═══════════════════════════════════════════════════════════════

/**
 * Ask the content script on an active claude.ai tab to fetch usage data.
 * @returns {Promise<Object>} Usage data or error
 */
async function fetchUsageViaContentScript() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    if (tabs.length === 0) {
      // No claude.ai tab — return cached data
      const cached = await getCachedUsageData();
      if (cached && cached.ok) return cached;
      return { ok: false, error: 'No claude.ai tab open. Open claude.ai to fetch usage data.' };
    }

    // Send message to the first claude.ai tab's content script
    const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'FETCH_USAGE' });
    if (response && response.ok) {
      // Cache the fresh data
      await chrome.storage.local.set({
        cachedUsage: response,
        lastFetchTime: Date.now()
      });

      // Save a snapshot for history tracking
      await saveUsageSnapshot(response);
    }
    return response || { ok: false, error: 'No response from content script' };
  } catch (e) {
    // Content script may not be loaded yet
    return { ok: false, error: 'Could not reach claude.ai. Try refreshing the page.' };
  }
}

/**
 * Get cached usage data from storage.
 * @returns {Promise<Object>}
 */
async function getCachedUsageData() {
  const { cachedUsage, lastFetchTime } = await chrome.storage.local.get(['cachedUsage', 'lastFetchTime']);
  if (cachedUsage) {
    cachedUsage.fromCache = true;
    cachedUsage.cacheAge = Date.now() - (lastFetchTime || 0);
  }
  return cachedUsage || { ok: false, error: 'No cached data. Open claude.ai to fetch usage.' };
}

/**
 * Cache intercepted usage data (from passive fetch interception).
 * @param {string} url - The API URL that was intercepted
 * @param {Object} data - The parsed JSON response
 * @param {number} timestamp - When the data was captured
 */
async function cacheUsageData(url, data, timestamp) {
  const { interceptedData = {} } = await chrome.storage.local.get('interceptedData');
  // Key by URL path for easy lookup
  const key = url.replace(/https?:\/\/[^/]+/, '');
  interceptedData[key] = { data, timestamp };
  await chrome.storage.local.set({ interceptedData });
}

/**
 * Save a daily usage snapshot for history tracking.
 * Stores one snapshot per day so users can see trends.
 * @param {Object} usageResponse - The full usage response
 */
async function saveUsageSnapshot(usageResponse) {
  const today = getDateString(new Date());
  const { usageHistory = {} } = await chrome.storage.local.get('usageHistory');

  usageHistory[today] = {
    timestamp: Date.now(),
    usage: usageResponse.usage,
    rateLimit: usageResponse.rateLimit,
    organization: usageResponse.organization
  };

  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = getDateString(cutoff);
  for (const date of Object.keys(usageHistory)) {
    if (date < cutoffStr) delete usageHistory[date];
  }

  await chrome.storage.local.set({ usageHistory });
}

/**
 * Get usage history snapshots.
 * @returns {Promise<Object>}
 */
async function getUsageHistory() {
  const { usageHistory = {} } = await chrome.storage.local.get('usageHistory');
  return { ok: true, history: usageHistory };
}
