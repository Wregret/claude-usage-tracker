/**
 * Shared utility functions for Claude Usage Tracker.
 * Used by the popup (loaded via <script> tag).
 */

/**
 * Format a token count for display: "1,234", "15.2K", "1.5M".
 * @param {number} count
 * @returns {string}
 */
function formatTokens(count) {
  if (count < 1000) return count.toLocaleString();
  if (count < 100000) return (count / 1000).toFixed(1) + 'K';
  if (count < 1000000) return Math.round(count / 1000) + 'K';
  return (count / 1000000).toFixed(1) + 'M';
}

/**
 * Extract plan name from usage data.
 * Searches multiple possible locations in the API response.
 * @param {Object} data - Usage data from content script
 * @returns {string|null}
 */
function extractPlanName(data) {
  if (!data) return null;

  // Check organization data
  if (data.organization) {
    const org = data.organization;
    // capabilities array: ["chat", "claude_pro"] → "Pro"
    if (Array.isArray(org.capabilities)) {
      const cap = org.capabilities.find(c => /^claude_/i.test(c));
      if (cap) return cap.replace(/^claude_/i, '').replace(/\b\w/g, c => c.toUpperCase());
    }
    if (org.plan) return typeof org.plan === 'string' ? org.plan : org.plan.name || null;
    if (org.subscription) {
      const sub = org.subscription;
      return sub.plan || sub.plan_name || sub.type || null;
    }
    if (org.billing) return org.billing.plan || null;
    if (org.billing_type) {
      // "stripe_subscription" → "Subscription"
      return org.billing_type.replace(/^stripe_/i, '').replace(/\b\w/g, c => c.toUpperCase());
    }
    if (org.rate_limit_tier) return org.rate_limit_tier;
  }

  // Check settings data
  if (data.settings) {
    const s = data.settings;
    if (s.plan) return typeof s.plan === 'string' ? s.plan : s.plan.name || null;
  }

  // Check usage data
  if (data.usage && data.usage.plan) {
    return typeof data.usage.plan === 'string' ? data.usage.plan : data.usage.plan.name || null;
  }

  return null;
}
