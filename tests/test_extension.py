#!/usr/bin/env python3
"""
Test suite for Claude Usage Tracker Chrome Extension.

The extension mirrors claude.ai/settings/usage by:
  - Fetching usage data from claude.ai's internal API
  - Displaying usage percentage bars in the popup

Run:  python3 tests/test_extension.py
"""

import json
import re
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ═══════════════════════════════════════════════════════════════
# Manifest
# ═══════════════════════════════════════════════════════════════

class TestManifest(unittest.TestCase):

    def setUp(self):
        with open(ROOT / "manifest.json") as f:
            self.m = json.load(f)

    def test_manifest_v3(self):
        self.assertEqual(self.m["manifest_version"], 3)

    def test_required_fields(self):
        for f in ["name", "version", "description", "permissions", "background", "action"]:
            self.assertIn(f, self.m)

    def test_permissions(self):
        perms = set(self.m["permissions"])
        self.assertIn("storage", perms)
        self.assertIn("alarms", perms)
        self.assertIn("scripting", perms)

    def test_no_unnecessary_permissions(self):
        perms = set(self.m["permissions"])
        allowed = {"storage", "alarms", "tabs", "scripting"}
        self.assertEqual(perms - allowed, set())

    def test_host_permissions(self):
        self.assertTrue(any("claude.ai" in h for h in self.m.get("host_permissions", [])))

    def test_no_module_type(self):
        self.assertNotIn("type", self.m.get("background", {}))

    def test_service_worker_exists(self):
        self.assertTrue((ROOT / self.m["background"]["service_worker"]).exists())

    def test_content_scripts_exist(self):
        for cs in self.m.get("content_scripts", []):
            for js in cs.get("js", []):
                self.assertTrue((ROOT / js).exists(), f"Missing: {js}")

    def test_popup_exists(self):
        self.assertTrue((ROOT / self.m["action"]["default_popup"]).exists())

    def test_icons_exist(self):
        for icons in [self.m.get("icons", {}), self.m.get("action", {}).get("default_icon", {})]:
            for _, path in icons.items():
                self.assertTrue((ROOT / path).exists(), f"Missing icon: {path}")

    def test_version_format(self):
        self.assertRegex(self.m["version"], r"^\d+\.\d+\.\d+$")


# ═══════════════════════════════════════════════════════════════
# Service Worker
# ═══════════════════════════════════════════════════════════════

class TestServiceWorker(unittest.TestCase):

    def setUp(self):
        with open(ROOT / "manifest.json") as f:
            m = json.load(f)
        with open(ROOT / m["background"]["service_worker"]) as f:
            self.code = f.read()

    def test_no_import_scripts(self):
        """CRITICAL: importScripts caused repeated extension load failures."""
        for i, line in enumerate(self.code.split('\n'), 1):
            s = line.strip()
            if s.startswith('//') or s.startswith('*'):
                continue
            self.assertNotIn('importScripts(', s, f"Line {i}: {s}")

    def test_handles_org_id_discovered(self):
        self.assertIn("ORG_ID_DISCOVERED", self.code)

    def test_handles_popup_fetch_usage(self):
        self.assertIn("POPUP_FETCH_USAGE", self.code)

    def test_handles_popup_get_cached(self):
        self.assertIn("POPUP_GET_CACHED", self.code)

    def test_handles_popup_get_history(self):
        self.assertIn("POPUP_GET_HISTORY", self.code)

    def test_relays_to_content_script(self):
        """Must send FETCH_USAGE to content script via chrome.tabs.sendMessage."""
        self.assertIn("chrome.tabs.sendMessage", self.code)
        self.assertIn("FETCH_USAGE", self.code)

    def test_queries_claude_tabs(self):
        self.assertIn("claude.ai", self.code)

    def test_caches_usage_data(self):
        self.assertIn("chrome.storage.local.set", self.code)
        self.assertIn("cachedUsage", self.code)

    def test_saves_usage_history(self):
        self.assertIn("usageHistory", self.code)

    def test_prunes_old_history(self):
        self.assertIn("90", self.code)

    def test_has_periodic_refresh(self):
        self.assertIn("chrome.alarms.create", self.code)
        self.assertIn("chrome.alarms.onAlarm.addListener", self.code)

    def test_has_message_listener(self):
        self.assertIn("chrome.runtime.onMessage.addListener", self.code)

    def test_injects_content_script_on_failure(self):
        """Must fall back to chrome.scripting.executeScript if content script isn't loaded."""
        self.assertIn("chrome.scripting.executeScript", self.code)

    def test_validates_sender(self):
        """Must only accept messages from own extension."""
        self.assertIn("sender.id", self.code)
        self.assertIn("chrome.runtime.id", self.code)

    def test_validates_org_id_format(self):
        """Must validate org ID is a UUID before storing."""
        self.assertTrue(re.search(r'[a-f0-9].*-.*36', self.code),
            "Must have UUID pattern validation for org ID")

    def test_no_intercepted_data(self):
        """Passive interception was removed — no interceptedData storage."""
        self.assertNotIn("interceptedData", self.code)
        self.assertNotIn("USAGE_DATA_INTERCEPTED", self.code)

    def test_balanced_braces(self):
        self.assertEqual(self.code.count('{'), self.code.count('}'))


# ═══════════════════════════════════════════════════════════════
# Content Script
# ═══════════════════════════════════════════════════════════════

class TestContentScript(unittest.TestCase):

    def setUp(self):
        with open(ROOT / "content" / "content-script.js") as f:
            self.code = f.read()

    def test_is_iife(self):
        self.assertTrue(re.search(r'\(\s*\(\s*\)\s*=>\s*\{', self.code))

    def test_uses_strict_mode(self):
        self.assertIn("'use strict'", self.code)

    def test_no_fetch_monkey_patch(self):
        """Fetch interception doesn't work in MV3 isolated world — must not exist."""
        self.assertNotIn("window.fetch", self.code)
        self.assertNotIn("originalFetch", self.code)
        self.assertNotIn("USAGE_DATA_INTERCEPTED", self.code)

    def test_discovers_org_id(self):
        """Must discover org ID via API fetch."""
        self.assertIn("discoverOrgId", self.code)
        self.assertIn("/api/organizations", self.code)

    def test_discovers_org_id_from_url(self):
        """Must have UUID pattern matching as fallback."""
        self.assertTrue(re.search(r'[a-f0-9].*-.*36', self.code))

    def test_sends_org_id_to_background(self):
        self.assertIn("ORG_ID_DISCOVERED", self.code)
        self.assertIn("chrome.runtime.sendMessage", self.code)

    def test_handles_fetch_usage_request(self):
        self.assertIn("FETCH_USAGE", self.code)

    def test_fetches_usage_api(self):
        self.assertIn("/api/organizations/", self.code)
        self.assertIn("/usage", self.code)

    def test_fetches_rate_limit_api(self):
        self.assertIn("rate_limit", self.code)

    def test_uses_credentials_include(self):
        self.assertIn("credentials", self.code)
        self.assertIn("include", self.code)

    def test_fetches_multiple_endpoints(self):
        self.assertIn("Promise.allSettled", self.code)

    def test_has_safe_fetch(self):
        self.assertIn("safeFetch", self.code)

    def test_handles_get_org_id_request(self):
        self.assertIn("GET_ORG_ID", self.code)

    def test_discovers_org_id_on_load(self):
        self.assertIn("setTimeout", self.code)
        self.assertIn("discoverOrgId", self.code)

    def test_no_import_scripts(self):
        for i, line in enumerate(self.code.split('\n'), 1):
            s = line.strip()
            if s.startswith('//') or s.startswith('*'):
                continue
            self.assertNotIn('importScripts(', s)

    def test_balanced_braces(self):
        self.assertEqual(self.code.count('{'), self.code.count('}'))


# ═══════════════════════════════════════════════════════════════
# Popup
# ═══════════════════════════════════════════════════════════════

class TestPopup(unittest.TestCase):

    def setUp(self):
        with open(ROOT / "popup" / "popup.html") as f:
            self.html = f.read()
        with open(ROOT / "popup" / "popup.css") as f:
            self.css = f.read()
        with open(ROOT / "popup" / "popup.js") as f:
            self.js = f.read()

    # ─── HTML ─────────────────────────────────────────

    def test_html_includes_scripts(self):
        for s in ["chart.min.js", "time.js", "popup.js"]:
            self.assertIn(s, self.html)

    def test_html_includes_css(self):
        self.assertIn("popup.css", self.html)

    def test_all_script_files_exist(self):
        popup_dir = ROOT / "popup"
        for src in re.findall(r'<script\s+src="([^"]+)"', self.html):
            self.assertTrue((popup_dir / src).resolve().exists(), f"Missing: {src}")

    def test_has_refresh_button(self):
        self.assertIn('id="refresh-btn"', self.html)

    def test_has_status_bar(self):
        self.assertIn('id="status-text"', self.html)

    def test_has_usage_bars_container(self):
        self.assertIn('id="usage-bars"', self.html)

    def test_has_error_card(self):
        self.assertIn('id="error-card"', self.html)

    def test_has_plan_badge(self):
        self.assertIn('id="plan-badge"', self.html)

    def test_has_details_section(self):
        self.assertIn('id="details-body"', self.html)
        self.assertIn('id="details-json"', self.html)

    def test_has_history_chart(self):
        self.assertIn('id="history-chart"', self.html)

    def test_has_rate_limit_section(self):
        self.assertIn('id="rate-limit-card"', self.html)

    # ─── JS ───────────────────────────────────────────

    def test_js_is_iife(self):
        self.assertTrue(re.search(r'\(\s*\(\s*\)\s*=>\s*\{', self.js))

    def test_js_sends_popup_fetch_usage(self):
        self.assertIn("POPUP_FETCH_USAGE", self.js)

    def test_js_sends_popup_get_cached(self):
        self.assertIn("POPUP_GET_CACHED", self.js)

    def test_js_sends_popup_get_history(self):
        self.assertIn("POPUP_GET_HISTORY", self.js)

    def test_js_renders_usage_bars(self):
        self.assertIn("renderUsageBars", self.js)
        self.assertIn("usage-bar-fill", self.js)

    def test_js_extracts_usage_bars(self):
        self.assertIn("extractUsageBars", self.js)

    def test_js_handles_utilization(self):
        """Must handle the actual API shape: { utilization: N, resets_at: ... }."""
        self.assertIn("utilization", self.js)

    def test_js_color_codes_bars(self):
        self.assertIn("bar-ok", self.js)
        self.assertIn("bar-warning", self.js)
        self.assertIn("bar-danger", self.js)

    def test_js_escapes_all_html_output(self):
        """All innerHTML interpolations must use escapeHtml."""
        self.assertIn("escapeHtml", self.js)
        # renderRateLimits must escape formatResetTime and formatLabel
        rate_limit_section = self.js[self.js.index("renderRateLimits"):]
        rate_limit_section = rate_limit_section[:rate_limit_section.index("\n  function ")]
        self.assertNotIn("${formatResetTime(", rate_limit_section,
            "formatResetTime output must be escaped in innerHTML")
        self.assertNotIn("${formatLabel(", rate_limit_section,
            "formatLabel output must be escaped in innerHTML")

    def test_js_shows_errors(self):
        self.assertIn("showError", self.js)

    def test_js_shows_cache_age(self):
        self.assertIn("fromCache", self.js)
        self.assertIn("formatTimeAgo", self.js)

    def test_js_creates_history_chart(self):
        self.assertIn("new Chart", self.js)

    def test_js_destroys_chart(self):
        self.assertIn(".destroy()", self.js)

    def test_js_has_refresh_handler(self):
        self.assertIn("setupRefreshButton", self.js)

    def test_js_has_details_toggle(self):
        self.assertIn("setupDetailsToggle", self.js)

    def test_js_renders_plan_name(self):
        self.assertIn("extractPlanName", self.js)

    def test_js_renders_rate_limits(self):
        self.assertIn("renderRateLimits", self.js)

    def test_js_balanced_braces(self):
        self.assertEqual(self.js.count('{'), self.js.count('}'))

    # ─── CSS ──────────────────────────────────────────

    def test_css_has_usage_bar_styles(self):
        self.assertIn(".usage-bar-track", self.css)
        self.assertIn(".usage-bar-fill", self.css)

    def test_css_has_color_classes(self):
        self.assertIn(".bar-ok", self.css)
        self.assertIn(".bar-warning", self.css)
        self.assertIn(".bar-danger", self.css)

    def test_css_has_refresh_spinner(self):
        self.assertIn(".spinning", self.css)

    def test_css_sets_width(self):
        self.assertRegex(self.css, r'width:\s*\d+px')

    def test_css_has_error_styles(self):
        self.assertIn(".error-card", self.css)


# ═══════════════════════════════════════════════════════════════
# Cross-File Contracts
# ═══════════════════════════════════════════════════════════════

class TestMessageContract(unittest.TestCase):
    """All message types sent must be handled by the receiver."""

    def setUp(self):
        with open(ROOT / "content" / "content-script.js") as f:
            self.cs = f.read()
        with open(ROOT / "manifest.json") as f:
            m = json.load(f)
        with open(ROOT / m["background"]["service_worker"]) as f:
            self.sw = f.read()
        with open(ROOT / "popup" / "popup.js") as f:
            self.popup = f.read()

    def test_content_to_bg_messages_handled(self):
        """Messages content script sends must be handled by service worker."""
        sent = set(re.findall(r"type:\s*['\"](\w+)['\"]", self.cs))
        sent.discard("FETCH_USAGE")
        sent.discard("GET_ORG_ID")
        for msg_type in sent:
            self.assertIn(msg_type, self.sw,
                f"Content sends '{msg_type}' but service worker doesn't handle it")

    def test_popup_to_bg_messages_handled(self):
        """Messages popup sends must be handled by service worker."""
        sent = set(re.findall(r"type:\s*['\"](\w+)['\"]", self.popup))
        for msg_type in sent:
            self.assertIn(msg_type, self.sw,
                f"Popup sends '{msg_type}' but service worker doesn't handle it")

    def test_bg_to_content_messages_handled(self):
        """FETCH_USAGE sent by service worker must be handled by content script."""
        self.assertIn("FETCH_USAGE", self.sw)
        self.assertIn("FETCH_USAGE", self.cs)


# ═══════════════════════════════════════════════════════════════
# Utils
# ═══════════════════════════════════════════════════════════════

class TestUtils(unittest.TestCase):

    def setUp(self):
        with open(ROOT / "utils" / "time.js") as f:
            self.code = f.read()

    def test_has_format_tokens(self):
        self.assertIn("function formatTokens", self.code)

    def test_has_extract_plan_name(self):
        self.assertIn("function extractPlanName", self.code)

    def test_balanced_braces(self):
        self.assertEqual(self.code.count('{'), self.code.count('}'))


# ═══════════════════════════════════════════════════════════════
# Icons & File Structure
# ═══════════════════════════════════════════════════════════════

class TestIcons(unittest.TestCase):
    def _check_png(self, path, expected_size=None):
        with open(path, 'rb') as f:
            header = f.read(8)
        self.assertEqual(header, b'\x89PNG\r\n\x1a\n')
        if expected_size:
            with open(path, 'rb') as f:
                f.read(16)
                w = struct.unpack('>I', f.read(4))[0]
                h = struct.unpack('>I', f.read(4))[0]
            self.assertEqual(w, expected_size)
            self.assertEqual(h, expected_size)

    def test_icons(self):
        for size in [16, 48, 128]:
            self._check_png(ROOT / "icons" / f"icon{size}.png", size)


class TestFileStructure(unittest.TestCase):
    REQUIRED = [
        "manifest.json", "background/service-worker.js",
        "content/content-script.js", "popup/popup.html",
        "popup/popup.css", "popup/popup.js",
        "lib/chart.min.js", "utils/time.js",
        "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
    ]

    def test_all_files_exist(self):
        missing = [f for f in self.REQUIRED if not (ROOT / f).exists()]
        self.assertEqual(missing, [])

    def test_no_stale_root_service_worker(self):
        self.assertFalse((ROOT / "service-worker.js").exists())

    def test_gitignore_exists(self):
        self.assertTrue((ROOT / ".gitignore").exists())


class TestPrivacy(unittest.TestCase):
    """Extension must not make external network requests."""

    def test_service_worker_no_fetch(self):
        with open(ROOT / "manifest.json") as f:
            m = json.load(f)
        with open(ROOT / m["background"]["service_worker"]) as f:
            code = f.read()
        self.assertEqual(len(re.findall(r'\bfetch\s*\(', code)), 0,
            "Service worker must not call fetch() — it relays to content script")

    def test_no_external_scripts_in_popup(self):
        with open(ROOT / "popup" / "popup.html") as f:
            html = f.read()
        ext = re.findall(r'<script[^>]+src="https?://', html)
        self.assertEqual(len(ext), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
