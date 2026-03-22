/**
 * Storage layer for Claude Usage Tracker.
 * Wraps chrome.storage.local with typed accessors for sessions,
 * daily aggregates, and weekly summaries.
 */

const Storage = {

  // ─── Active Session ──────────────────────────────────────────

  /**
   * Get the currently active session, or null if none.
   * @returns {Promise<Object|null>}
   */
  async getActiveSession() {
    const { activeSession } = await chrome.storage.local.get('activeSession');
    return activeSession || null;
  },

  /**
   * Set or update the active session.
   * @param {Object} session - Active session object
   */
  async setActiveSession(session) {
    await chrome.storage.local.set({ activeSession: session });
  },

  /**
   * Clear the active session (set to null).
   */
  async clearActiveSession() {
    await chrome.storage.local.remove('activeSession');
  },

  // ─── Completed Sessions ──────────────────────────────────────

  /**
   * Save a completed session to the sessions array.
   * @param {Object} session - Completed session with endTime and duration
   */
  async saveSession(session) {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    sessions.push(session);
    await chrome.storage.local.set({ sessions });
  },

  /**
   * Get all saved sessions, optionally filtered by date range.
   * @param {Object} [options]
   * @param {string} [options.startDate] - ISO date string (inclusive)
   * @param {string} [options.endDate] - ISO date string (inclusive)
   * @returns {Promise<Array>} Array of session objects
   */
  async getSessions({ startDate, endDate } = {}) {
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    if (!startDate && !endDate) return sessions;
    return sessions.filter(s => {
      if (startDate && s.date < startDate) return false;
      if (endDate && s.date > endDate) return false;
      return true;
    });
  },

  // ─── Daily Aggregates ────────────────────────────────────────

  /**
   * Update daily aggregate totals for a given date.
   * Increments duration, messages, and sessions count.
   * @param {string} date - ISO date string (YYYY-MM-DD)
   * @param {Object} delta - Values to add
   * @param {number} [delta.duration=0] - Duration in ms to add
   * @param {number} [delta.messages=0] - Message count to add
   * @param {number} [delta.sessions=0] - Session count to add
   */
  async updateDailyAggregate(date, { duration = 0, messages = 0, sessions = 0 }) {
    const { dailyAggregates = {} } = await chrome.storage.local.get('dailyAggregates');
    if (!dailyAggregates[date]) {
      dailyAggregates[date] = { duration: 0, messages: 0, sessions: 0 };
    }
    dailyAggregates[date].duration += duration;
    dailyAggregates[date].messages += messages;
    dailyAggregates[date].sessions += sessions;
    await chrome.storage.local.set({ dailyAggregates });
  },

  /**
   * Get all daily aggregates.
   * @returns {Promise<Object>} Map of date string to aggregate object
   */
  async getDailyAggregates() {
    const { dailyAggregates = {} } = await chrome.storage.local.get('dailyAggregates');
    return dailyAggregates;
  },

  // ─── Hourly Aggregates ───────────────────────────────────────

  /**
   * Increment the hourly activity counter.
   * Used for "most active hour" analysis.
   * @param {number} hour - Hour of day (0-23)
   * @param {number} [messageCount=1] - Messages to add
   */
  async incrementHourlyAggregate(hour, messageCount = 1) {
    const { hourlyAggregates = {} } = await chrome.storage.local.get('hourlyAggregates');
    if (!hourlyAggregates[hour]) {
      hourlyAggregates[hour] = { messages: 0, sessions: 0 };
    }
    hourlyAggregates[hour].messages += messageCount;
    await chrome.storage.local.set({ hourlyAggregates });
  },

  /**
   * Increment hourly session count when a session starts.
   * @param {number} hour - Hour of day (0-23)
   */
  async incrementHourlySession(hour) {
    const { hourlyAggregates = {} } = await chrome.storage.local.get('hourlyAggregates');
    if (!hourlyAggregates[hour]) {
      hourlyAggregates[hour] = { messages: 0, sessions: 0 };
    }
    hourlyAggregates[hour].sessions += 1;
    await chrome.storage.local.set({ hourlyAggregates });
  },

  /**
   * Get all hourly aggregates.
   * @returns {Promise<Object>} Map of hour (0-23) to aggregate object
   */
  async getHourlyAggregates() {
    const { hourlyAggregates = {} } = await chrome.storage.local.get('hourlyAggregates');
    return hourlyAggregates;
  },

  // ─── Day-of-Week Aggregates ──────────────────────────────────

  /**
   * Increment day-of-week aggregate for activity analysis.
   * @param {number} dayIndex - Day of week (0=Mon, 6=Sun)
   * @param {Object} delta
   * @param {number} [delta.duration=0] - Duration in ms
   * @param {number} [delta.messages=0] - Message count
   */
  async incrementDayOfWeekAggregate(dayIndex, { duration = 0, messages = 0 }) {
    const { dayOfWeekAggregates = {} } = await chrome.storage.local.get('dayOfWeekAggregates');
    if (!dayOfWeekAggregates[dayIndex]) {
      dayOfWeekAggregates[dayIndex] = { duration: 0, messages: 0, sessions: 0 };
    }
    dayOfWeekAggregates[dayIndex].duration += duration;
    dayOfWeekAggregates[dayIndex].messages += messages;
    dayOfWeekAggregates[dayIndex].sessions += 1;
    await chrome.storage.local.set({ dayOfWeekAggregates });
  },

  /**
   * Get all day-of-week aggregates.
   * @returns {Promise<Object>} Map of day index to aggregate object
   */
  async getDayOfWeekAggregates() {
    const { dayOfWeekAggregates = {} } = await chrome.storage.local.get('dayOfWeekAggregates');
    return dayOfWeekAggregates;
  },

  // ─── Data Management ─────────────────────────────────────────

  /**
   * Remove sessions older than maxAgeDays.
   * Also cleans up daily aggregates older than the threshold.
   * @param {number} [maxAgeDays=90] - Maximum age in days
   */
  async pruneOldData(maxAgeDays = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffStr = getDateString(cutoffDate);

    // Prune sessions
    const { sessions = [] } = await chrome.storage.local.get('sessions');
    const filtered = sessions.filter(s => s.date >= cutoffStr);

    // Prune daily aggregates
    const { dailyAggregates = {} } = await chrome.storage.local.get('dailyAggregates');
    const prunedAggregates = {};
    for (const [date, data] of Object.entries(dailyAggregates)) {
      if (date >= cutoffStr) prunedAggregates[date] = data;
    }

    await chrome.storage.local.set({
      sessions: filtered,
      dailyAggregates: prunedAggregates
    });
  },

  /**
   * Get all stored data (for debugging or export).
   * @returns {Promise<Object>} All stored data
   */
  async getAllData() {
    return await chrome.storage.local.get(null);
  },

  /**
   * Clear all stored data.
   */
  async clearAllData() {
    await chrome.storage.local.clear();
  }
};
