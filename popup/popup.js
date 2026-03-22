/**
 * Popup script for Claude Usage Tracker.
 *
 * Manages three tabs:
 * - Dashboard: live session info, today/week summaries, quick stats
 * - Sessions: scrollable list of recent sessions grouped by date
 * - Analytics: Chart.js line/bar charts for usage trends
 */

(() => {
  'use strict';

  // ─── State ───────────────────────────────────────────────────

  /** Timer ID for live session duration updates */
  let liveTimerInterval = null;

  /** Chart.js instances (destroyed and recreated on tab switch) */
  let dailyChart = null;
  let dowChart = null;
  let hourlyChart = null;

  /** Currently selected analytics date range (days, or 'all') */
  let selectedRange = 7;

  // ─── Initialization ────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupRangeSelector();
    renderDashboard();
  });

  // ─── Tab Management ────────────────────────────────────────

  /**
   * Set up click handlers for tab navigation.
   * Switches visible content and triggers tab-specific rendering.
   */
  function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Deactivate all tabs and content
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        // Activate clicked tab and its content
        tab.classList.add('active');
        const tabId = tab.dataset.tab;
        document.getElementById(tabId).classList.add('active');

        // Render tab-specific content
        if (tabId === 'dashboard') renderDashboard();
        else if (tabId === 'sessions') renderSessions();
        else if (tabId === 'analytics') renderAnalytics();
      });
    });
  }

  // ─── Dashboard Tab ─────────────────────────────────────────

  /**
   * Render the dashboard with current session, today's stats,
   * weekly stats, and quick stats.
   */
  async function renderDashboard() {
    // Stop any existing live timer
    clearInterval(liveTimerInterval);

    // Current session
    const activeSession = await Storage.getActiveSession();
    const sessionCard = document.getElementById('current-session-card');
    const noSessionCard = document.getElementById('no-session-card');

    if (activeSession) {
      sessionCard.classList.remove('hidden');
      noSessionCard.classList.add('hidden');
      updateSessionDisplay(activeSession);
      // Start live timer to update duration every second
      liveTimerInterval = setInterval(() => updateSessionDisplay(activeSession), 1000);
    } else {
      sessionCard.classList.add('hidden');
      noSessionCard.classList.remove('hidden');
    }

    // Today's summary
    const today = getDateString(new Date());
    const dailyAgg = await Storage.getDailyAggregates();
    const todayData = dailyAgg[today] || { duration: 0, messages: 0, sessions: 0 };

    // Include active session in today's totals
    if (activeSession) {
      const liveDuration = Date.now() - activeSession.startTime;
      todayData.duration += liveDuration;
      todayData.messages += activeSession.messageCount;
      todayData.sessions += 1;
    }

    document.getElementById('today-duration').textContent = formatDuration(todayData.duration);
    document.getElementById('today-messages').textContent = todayData.messages;
    document.getElementById('today-sessions').textContent = todayData.sessions;

    // This week's summary
    const weekStart = getWeekStart(new Date());
    let weekDuration = 0, weekMessages = 0, weekSessions = 0;
    for (const [date, data] of Object.entries(dailyAgg)) {
      if (date >= weekStart) {
        weekDuration += data.duration;
        weekMessages += data.messages;
        weekSessions += data.sessions;
      }
    }
    // Include active session in weekly totals
    if (activeSession) {
      weekDuration += Date.now() - activeSession.startTime;
      weekMessages += activeSession.messageCount;
      weekSessions += 1;
    }

    document.getElementById('week-duration').textContent = formatDuration(weekDuration);
    document.getElementById('week-messages').textContent = weekMessages;
    document.getElementById('week-sessions').textContent = weekSessions;

    // Quick stats
    await renderQuickStats();
  }

  /**
   * Update the live session display (duration and message count).
   * Called every second while a session is active.
   * @param {Object} session - Active session object
   */
  function updateSessionDisplay(session) {
    const elapsed = Date.now() - session.startTime;
    document.getElementById('session-duration').textContent = formatDuration(elapsed);
    document.getElementById('session-messages').textContent = session.messageCount;
  }

  /**
   * Compute and display quick stats: most active day, peak hour, avg session.
   */
  async function renderQuickStats() {
    // Most active day of week
    const dowAgg = await Storage.getDayOfWeekAggregates();
    let maxDayMessages = 0;
    let mostActiveDay = '--';
    for (const [dayIdx, data] of Object.entries(dowAgg)) {
      if (data.messages > maxDayMessages) {
        maxDayMessages = data.messages;
        mostActiveDay = DAY_NAMES[parseInt(dayIdx)];
      }
    }
    document.getElementById('most-active-day').textContent = mostActiveDay;

    // Peak hour
    const hourlyAgg = await Storage.getHourlyAggregates();
    let maxHourMessages = 0;
    let peakHour = '--';
    for (const [hour, data] of Object.entries(hourlyAgg)) {
      if (data.messages > maxHourMessages) {
        maxHourMessages = data.messages;
        const h = parseInt(hour);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        peakHour = `${h12}-${(h12 % 12) + 1} ${ampm}`;
      }
    }
    document.getElementById('peak-hour').textContent = peakHour;

    // Average session duration
    const sessions = await Storage.getSessions();
    if (sessions.length > 0) {
      const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
      const avgDuration = totalDuration / sessions.length;
      document.getElementById('avg-session').textContent = formatDuration(avgDuration);
    } else {
      document.getElementById('avg-session').textContent = '--';
    }
  }

  // ─── Sessions Tab ──────────────────────────────────────────

  /**
   * Render the sessions list, grouped by date, most recent first.
   */
  async function renderSessions() {
    const sessions = await Storage.getSessions();
    const container = document.getElementById('sessions-list');

    if (sessions.length === 0) {
      container.innerHTML = '<p class="muted center">No sessions recorded yet.</p>';
      return;
    }

    // Sort by startTime descending (most recent first)
    sessions.sort((a, b) => b.startTime - a.startTime);

    // Group by date
    const groups = {};
    for (const session of sessions) {
      if (!groups[session.date]) groups[session.date] = [];
      groups[session.date].push(session);
    }

    // Build HTML
    let html = '';
    for (const [date, dateSessions] of Object.entries(groups)) {
      const label = getRelativeDateLabel(date);
      html += `<div class="session-date-group">`;
      html += `<div class="session-date-header">${label}</div>`;
      for (const s of dateSessions) {
        const time = formatTime(s.startTime);
        const duration = formatDuration(s.duration);
        html += `
          <div class="session-item">
            <span class="session-time">${time}</span>
            <div class="session-meta">
              <span>${duration}</span>
              <span>${s.messageCount} msgs</span>
            </div>
          </div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;
  }

  // ─── Analytics Tab ─────────────────────────────────────────

  /**
   * Set up the date range selector buttons.
   */
  function setupRangeSelector() {
    const buttons = document.querySelectorAll('.range-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedRange = btn.dataset.range === 'all' ? 'all' : parseInt(btn.dataset.range);
        renderAnalytics();
      });
    });
  }

  /**
   * Render all analytics charts for the selected date range.
   */
  async function renderAnalytics() {
    // Destroy existing charts to prevent memory leaks
    if (dailyChart) { dailyChart.destroy(); dailyChart = null; }
    if (dowChart) { dowChart.destroy(); dowChart = null; }
    if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }

    await renderDailyChart();
    await renderDowChart();
    await renderHourlyChart();
  }

  /**
   * Render the daily usage line chart.
   * Shows duration (hours) and messages per day.
   */
  async function renderDailyChart() {
    const dailyAgg = await Storage.getDailyAggregates();

    // Generate date labels for the selected range
    const dates = [];
    const now = new Date();

    if (selectedRange === 'all') {
      // Use all dates that have data, sorted
      const allDates = Object.keys(dailyAgg).sort();
      dates.push(...allDates);
    } else {
      // Generate last N days
      for (let i = selectedRange - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(getDateString(d));
      }
    }

    // Build data arrays
    const durationData = dates.map(d => {
      const agg = dailyAgg[d];
      return agg ? +(agg.duration / 3600000).toFixed(2) : 0; // Convert ms to hours
    });
    const messageData = dates.map(d => {
      const agg = dailyAgg[d];
      return agg ? agg.messages : 0;
    });

    // Short date labels (e.g., "Mar 22")
    const labels = dates.map(d => {
      const parts = d.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
    });

    const ctx = document.getElementById('daily-chart').getContext('2d');
    dailyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Hours',
            data: durationData,
            borderColor: '#d97706',
            backgroundColor: 'rgba(217, 119, 6, 0.1)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Messages',
            data: messageData,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }
        },
        scales: {
          x: {
            ticks: { font: { size: 9 }, maxRotation: 45 }
          },
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Hours', font: { size: 10 } },
            ticks: { font: { size: 9 } },
            beginAtZero: true
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Messages', font: { size: 10 } },
            ticks: { font: { size: 9 } },
            beginAtZero: true,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  /**
   * Render the messages-by-day-of-week bar chart.
   */
  async function renderDowChart() {
    const dowAgg = await Storage.getDayOfWeekAggregates();

    const data = DAY_NAMES.map((_, i) => {
      const agg = dowAgg[i];
      return agg ? agg.messages : 0;
    });

    const ctx = document.getElementById('dow-chart').getContext('2d');
    dowChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: DAY_NAMES,
        datasets: [{
          label: 'Messages',
          data: data,
          backgroundColor: 'rgba(217, 119, 6, 0.7)',
          borderColor: '#d97706',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            ticks: { font: { size: 9 } },
            title: { display: true, text: 'Messages', font: { size: 10 } }
          }
        }
      }
    });
  }

  /**
   * Render the activity-by-hour bar chart (0-23 hours).
   */
  async function renderHourlyChart() {
    const hourlyAgg = await Storage.getHourlyAggregates();

    // Build data for all 24 hours
    const data = [];
    const labels = [];
    for (let h = 0; h < 24; h++) {
      const agg = hourlyAgg[h];
      data.push(agg ? agg.messages : 0);
      // Label: 12AM, 1AM, ..., 12PM, 1PM, ...
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      labels.push(`${h12}${ampm}`);
    }

    const ctx = document.getElementById('hourly-chart').getContext('2d');
    hourlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Messages',
          data: data,
          backgroundColor: 'rgba(99, 102, 241, 0.7)',
          borderColor: '#6366f1',
          borderWidth: 1,
          borderRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { font: { size: 8 }, maxRotation: 45 } },
          y: {
            beginAtZero: true,
            ticks: { font: { size: 9 } },
            title: { display: true, text: 'Messages', font: { size: 10 } }
          }
        }
      }
    });
  }

})();
