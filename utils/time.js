/**
 * Time utility functions shared across the extension.
 * Provides formatting, date arithmetic, and labeling helpers.
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "2h 15m", "45m", "< 1m"
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
  if (ms < 60000) return '< 1m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Get the Monday of the week containing the given date.
 * @param {Date|number} date - Date object or timestamp
 * @returns {string} ISO date string (YYYY-MM-DD) of Monday
 */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? 6 : day - 1; // Days since Monday
  d.setDate(d.getDate() - diff);
  return getDateString(d);
}

/**
 * Convert a timestamp or Date to an ISO date string (YYYY-MM-DD).
 * @param {Date|number} date - Date object or timestamp
 * @returns {string} ISO date string
 */
function getDateString(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the hour of day (0-23) from a timestamp.
 * @param {number} timestamp - Millisecond timestamp
 * @returns {number} Hour of day (0-23)
 */
function getHourOfDay(timestamp) {
  return new Date(timestamp).getHours();
}

/**
 * Get the day of week (0=Mon, 6=Sun) from a timestamp.
 * @param {number} timestamp - Millisecond timestamp
 * @returns {number} Day of week (0=Mon, 6=Sun)
 */
function getDayOfWeek(timestamp) {
  const jsDay = new Date(timestamp).getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Mon
}

/**
 * Day of week names indexed by our Mon=0 convention.
 */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Get a relative date label for display.
 * Returns "Today", "Yesterday", or a formatted date like "Mar 20, 2026".
 * @param {string} dateStr - ISO date string (YYYY-MM-DD)
 * @returns {string} Human-friendly label
 */
function getRelativeDateLabel(dateStr) {
  const today = getDateString(new Date());
  if (dateStr === today) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === getDateString(yesterday)) return 'Yesterday';

  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Format a timestamp as a time string (e.g., "2:30 PM").
 * @param {number} timestamp - Millisecond timestamp
 * @returns {string} Formatted time string
 */
function formatTime(timestamp) {
  const d = new Date(timestamp);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

// Export for use in modules (background service worker)
if (typeof globalThis !== 'undefined' && typeof importScripts === 'function') {
  // Service worker context — functions are already global
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatDuration, getWeekStart, getDateString, getHourOfDay,
    getDayOfWeek, DAY_NAMES, getRelativeDateLabel, formatTime
  };
}
