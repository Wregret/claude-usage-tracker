/**
 * Content script for Anthropic Platform (platform.claude.com).
 *
 * Fetches API usage/billing data using session cookies.
 *
 * Data sources (discovered via DevTools):
 *   GET /api/organizations/{id}                       → org info
 *   GET /api/organizations/{id}/usage_activities      → token/cost usage
 *   GET /api/organizations/{id}/rate_limits_v2        → rate limits
 *   GET /api/organizations/{id}/rate_limit_activities → rate limit history
 *   GET /api/organizations/{id}/models                → available models
 *   GET /api/organizations/{id}/max_minute_usage_activities → peak usage
 *   GET /api/console/organizations/{id}/workspaces    → workspaces
 *   GET /workspaces/default/cost                      → workspace cost
 *   GET /settings/limits                              → spending limits
 */

(() => {
  'use strict';

  let orgId = null;

  // ─── Message Handler ──────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_API_USAGE') {
      fetchApiUsageData().then(sendResponse);
      return true;
    }
    if (message.type === 'GET_API_ORG_ID') {
      sendResponse({ orgId });
      return false;
    }
  });

  // ─── API Fetching ─────────────────────────────────────────

  /**
   * Fetch API usage data from platform.claude.com's internal endpoints.
   * @returns {Promise<Object>}
   */
  async function fetchApiUsageData() {
    const result = {
      ok: false,
      source: 'api',
      orgId: null,
      organization: null,
      usage: null,
      rateLimits: null,
      models: null,
      cost: null,
      limits: null,
      error: null,
      timestamp: Date.now()
    };

    try {
      if (!orgId) {
        orgId = await discoverOrgId();
      }
      if (!orgId) {
        result.error = 'Could not find organization ID. Please open platform.claude.com and log in.';
        return result;
      }
      result.orgId = orgId;

      // Date range: first day of current month → day after tomorrow (buffer for timezone)
      const now = new Date();
      const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const bufferDate = new Date(now.getTime() + 2 * 86400000);
      const endDate = `${bufferDate.getFullYear()}-${String(bufferDate.getMonth() + 1).padStart(2, '0')}-${String(bufferDate.getDate()).padStart(2, '0')}`;
      const dateParams = `starting_on=${startDate}&ending_before=${endDate}`;

      const endpoints = [
        { key: 'organization', path: `/api/organizations/${orgId}` },
        { key: 'usage', path: `/api/organizations/${orgId}/usage_activities?${dateParams}` },
        { key: 'rateLimits', path: `/api/organizations/${orgId}/rate_limits_v2` },
        { key: 'rateLimitActivities', path: `/api/organizations/${orgId}/rate_limit_activities?${dateParams}` },
        { key: 'models', path: `/api/organizations/${orgId}/models` },
        { key: 'maxMinuteUsage', path: `/api/organizations/${orgId}/max_minute_usage_activities?${dateParams}` },
        { key: 'workspaces', path: `/api/console/organizations/${orgId}/workspaces` },
        { key: 'cost', path: '/workspaces/default/cost' },
        { key: 'limits', path: '/settings/limits' },
      ];

      const results = await Promise.allSettled(
        endpoints.map(ep => safeFetch(ep.path).then(data => ({ key: ep.key, data })))
      );

      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.data) continue;
        const { key, data } = r.value;
        switch (key) {
          case 'organization': result.organization = data; break;
          case 'usage': result.usage = data; break;
          case 'rateLimits': result.rateLimits = data; break;
          case 'rateLimitActivities': result.rateLimitActivities = data; break;
          case 'models': result.models = data; break;
          case 'maxMinuteUsage': result.maxMinuteUsage = data; break;
          case 'workspaces': result.workspaces = data; break;
          case 'cost': result.cost = data; break;
          case 'limits': result.limits = data; break;
        }
      }

      result.ok = !!(result.usage || result.rateLimits || result.organization || result.cost || result.limits);
      if (!result.ok) {
        result.error = 'Could not fetch API usage data. Endpoints may have changed.';
      }
    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  // ─── Org ID Discovery ────────────────────────────────────

  /**
   * Discover the org ID on platform.claude.com.
   * @returns {Promise<string|null>}
   */
  async function discoverOrgId() {
    // Method 1: Fetch the organizations list, pick the one with "api" capability
    try {
      const resp = await fetch('/api/organizations', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          const apiOrg = data.find(o =>
            Array.isArray(o.capabilities) && o.capabilities.some(c => c.includes('api'))
          );
          const org = apiOrg || data[0];
          return org.uuid || org.id || null;
        }
        if (data.uuid || data.id) {
          return data.uuid || data.id;
        }
      }
    } catch (e) {
      // Continue to fallback
    }

    // Method 2: Parse org ID from URL
    const urlMatch = window.location.href.match(/\/(organizations|workspaces)\/([a-f0-9-]{36})/i);
    if (urlMatch) return urlMatch[2];

    // Method 3: Check meta tags
    const meta = document.querySelector('meta[name="organization-id"], meta[name="workspace-id"]');
    if (meta) return meta.getAttribute('content');

    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────

  async function safeFetch(path) {
    try {
      const resp = await fetch(path, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!resp.ok) return null;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json')) return null;
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // ─── Initial Discovery ───────────────────────────────────

  setTimeout(() => {
    if (!orgId) {
      discoverOrgId().then(id => {
        if (id) {
          orgId = id;
          chrome.runtime.sendMessage({ type: 'API_ORG_ID_DISCOVERED', orgId: id });
        }
      });
    }
  }, 3000);

})();
