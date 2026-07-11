/**
 * Storage schema for Claude Usage Tracker.
 *
 * All storage operations use chrome.storage.local via the service worker.
 *
 * Chat pipeline (claude.ai):
 *   orgId           - string: discovered organization UUID
 *   cachedUsage     - object: last fetched chat usage data
 *   lastFetchTime   - number: epoch ms of last chat fetch
 *   usageHistory    - object: { "YYYY-MM-DD": { timestamp, windows: {key: max%} } }
 *                     daily MAX utilization per window (old entries may
 *                     instead hold raw { usage, rateLimit } snapshots)
 *
 * API pipeline (platform.claude.com):
 *   apiOrgId        - string: console workspace/org UUID
 *   cachedApiUsage  - object: last fetched API usage data
 *   lastApiFetchTime - number: epoch ms of last API fetch
 *   apiUsageHistory - object: { "YYYY-MM-DD": { timestamp, tokens: {input, output, total} } }
 *                     per-date token totals (old entries may hold raw snapshots)
 */
