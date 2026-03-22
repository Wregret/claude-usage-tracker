/**
 * Content script for Claude Usage Tracker.
 *
 * Runs on claude.ai pages in Chrome's isolated world. Two jobs:
 *
 * 1. Discover the user's organization ID by fetching /api/organizations.
 * 2. On demand (FETCH_USAGE message), fetch usage data from claude.ai's
 *    internal API. Session cookies are included automatically.
 *
 * Data sources:
 *   GET /api/organizations                        → org list + plan info
 *   GET /api/organizations/{id}/usage             → usage/billing data
 *   GET /api/organizations/{id}/rate_limit_status → rate limit percentage
 *   GET /api/organizations/{id}/settings          → plan/subscription details
 */

(() => {
  'use strict';

  /** Discovered organization ID. */
  let orgId = null;

  // ─── Message Handler ──────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_USAGE') {
      fetchUsageData().then(sendResponse);
      return true;
    }
    if (message.type === 'GET_ORG_ID') {
      sendResponse({ orgId });
      return false;
    }
  });

  // ─── API Fetching ─────────────────────────────────────────

  /**
   * Fetch usage data from claude.ai's internal API.
   * Tries multiple endpoints in parallel, returns whatever succeeds.
   * @returns {Promise<Object>}
   */
  async function fetchUsageData() {
    const result = {
      ok: false,
      orgId: null,
      organization: null,
      usage: null,
      rateLimit: null,
      settings: null,
      error: null,
      timestamp: Date.now()
    };

    try {
      if (!orgId) {
        orgId = await discoverOrgId();
      }
      if (!orgId) {
        result.error = 'Could not find organization ID. Please open a chat on claude.ai first.';
        return result;
      }
      result.orgId = orgId;

      const [orgData, usageData, rateLimitData, settingsData] = await Promise.allSettled([
        safeFetch(`/api/organizations/${orgId}`),
        safeFetch(`/api/organizations/${orgId}/usage`),
        safeFetch(`/api/organizations/${orgId}/rate_limit_status`),
        safeFetch(`/api/organizations/${orgId}/settings`)
      ]);

      if (orgData.status === 'fulfilled' && orgData.value) {
        result.organization = orgData.value;
      }
      if (usageData.status === 'fulfilled' && usageData.value) {
        result.usage = usageData.value;
      }
      if (rateLimitData.status === 'fulfilled' && rateLimitData.value) {
        result.rateLimit = rateLimitData.value;
      }
      if (settingsData.status === 'fulfilled' && settingsData.value) {
        result.settings = settingsData.value;
      }

      result.ok = !!(result.usage || result.rateLimit || result.organization);
      if (!result.ok) {
        result.error = 'Could not fetch usage data. API endpoints may have changed.';
      }
    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  // ─── Org ID Discovery ────────────────────────────────────

  /**
   * Discover the org ID. Tries the API first, then URL/DOM fallbacks.
   * @returns {Promise<string|null>}
   */
  async function discoverOrgId() {
    // Method 1: Fetch the organizations list
    try {
      const resp = await fetch('/api/organizations', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const orgs = await resp.json();
        if (Array.isArray(orgs) && orgs.length > 0) {
          return orgs[0].uuid || orgs[0].id || null;
        }
      }
    } catch (e) {
      // Continue to fallback
    }

    // Method 2: Parse org ID from current page URL
    const urlMatch = window.location.href.match(/\/organizations\/([a-f0-9-]{36})/i);
    if (urlMatch) return urlMatch[1];

    // Method 3: Check meta tags
    const metaOrg = document.querySelector('meta[name="organization-id"]');
    if (metaOrg) return metaOrg.getAttribute('content');

    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Fetch a claude.ai API endpoint. Returns parsed JSON or null on failure.
   * @param {string} path
   * @returns {Promise<Object|null>}
   */
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

  // Discover org ID shortly after page load
  setTimeout(() => {
    if (!orgId) {
      discoverOrgId().then(id => {
        if (id) {
          orgId = id;
          chrome.runtime.sendMessage({ type: 'ORG_ID_DISCOVERED', orgId: id });
        }
      });
    }
  }, 3000);

})();
