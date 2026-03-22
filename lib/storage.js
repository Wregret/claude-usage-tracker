/**
 * Storage schema for Claude Usage Tracker.
 *
 * All storage operations use chrome.storage.local via the service worker.
 *
 * Chat pipeline (claude.ai):
 *   orgId           - string: discovered organization UUID
 *   cachedUsage     - object: last fetched chat usage data
 *   lastFetchTime   - number: epoch ms of last chat fetch
 *   usageHistory    - object: { "YYYY-MM-DD": snapshot } for chat trend chart
 *
 * API pipeline (console.anthropic.com):
 *   apiOrgId        - string: console workspace/org UUID
 *   cachedApiUsage  - object: last fetched API usage data
 *   lastApiFetchTime - number: epoch ms of last API fetch
 *   apiUsageHistory - object: { "YYYY-MM-DD": snapshot } for API trend chart
 */
