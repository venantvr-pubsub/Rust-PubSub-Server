// Dashboard Guard - Intercepts page access and redirects to login if the dashboard is not enabled.
// This script MUST be included FIRST on every dashboard page (including login.html, which uses it
// only for the shared redirect-target helpers).
//
// Note on the threat model: `dashboardEnabled` in localStorage is a *convenience* flag, not a
// security boundary. The real state lives server-side (`/dashboard/status`) and is global to the
// process. The guard reconciles the two so a stale localStorage entry (e.g. after a server restart)
// cannot leave the user staring at a dashboard that will never receive an event.

(function () {
    'use strict';

    // Pages that require the dashboard to be enabled.
    const PROTECTED_PAGES = [
        '/control-panel.html',
        '/activity-map.html',
        '/circular-graph.html'
    ];

    const LOGIN_PAGE = '/login.html';
    const DEFAULT_PAGE = '/control-panel.html';
    const STORAGE_KEY = 'dashboardEnabled';

    // localStorage throws in a few browser configurations (private mode quotas, disabled storage).
    // Failing closed here would lock the user out of the dashboard entirely, so degrade gracefully.
    function readEnabled() {
        try {
            return window.localStorage.getItem(STORAGE_KEY) === 'true';
        } catch (_) {
            return false;
        }
    }

    function writeEnabled(value) {
        try {
            window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
        } catch (_) {
            /* storage unavailable - the server flag remains the source of truth */
        }
    }

    // Only ever redirect to a known same-origin dashboard page.
    // Without this, `/login.html?redirect=https://evil.example` is an open redirect.
    function safeRedirectTarget(rawTarget) {
        if (!rawTarget) return DEFAULT_PAGE;
        // A protocol-relative ("//evil.example") or absolute URL must never be honoured.
        if (!rawTarget.startsWith('/') || rawTarget.startsWith('//')) return DEFAULT_PAGE;
        return PROTECTED_PAGES.includes(rawTarget) ? rawTarget : DEFAULT_PAGE;
    }

    const currentPath = window.location.pathname;
    const isProtectedPage = PROTECTED_PAGES.includes(currentPath);
    const isDashboardEnabled = readEnabled();

    function redirectToLogin() {
        window.location.replace(`${LOGIN_PAGE}?redirect=${encodeURIComponent(currentPath)}`);
    }

    // `setupLogout` is called both from this script (once the DOM is ready) and from nav.js (once
    // the header markup exists). Whichever runs after the button exists wins; the flag keeps the
    // click handler from being attached twice, which would fire two logout requests per click.
    let logoutBound = false;

    function setupLogout() {
        if (logoutBound) return;
        const logoutBtn = document.getElementById('dashboardLogoutBtn');
        if (!logoutBtn) return;
        logoutBound = true;

        logoutBtn.addEventListener('click', async () => {
            logoutBtn.disabled = true;
            try {
                await fetch('/dashboard/logout', {method: 'POST'});
            } catch (error) {
                console.error('Logout error:', error);
            } finally {
                // Whatever the server said, drop the local flag and leave the dashboard.
                writeEnabled(false);
                window.location.href = LOGIN_PAGE;
            }
        });
    }

    // Reconcile the local flag with the server. A server restart resets `dashboard_enabled` to
    // false, and without this check the page would load, connect, and then silently receive
    // nothing forever.
    async function verifyWithServer() {
        try {
            const response = await fetch('/dashboard/status');
            if (!response.ok) return;
            const data = await response.json();
            if (data.dashboard_enabled === false) {
                writeEnabled(false);
                redirectToLogin();
            }
        } catch (error) {
            // Network hiccup: keep the page usable rather than bouncing the user to login.
            console.warn('Could not verify dashboard status:', error);
        }
    }

    if (isProtectedPage && !isDashboardEnabled) {
        redirectToLogin();
        // Stop this script here. Note that later <script> tags on the page still execute until the
        // navigation commits, which is why each page's own script is also defensive.
        throw new Error('Redirecting to login page');
    }

    if (isProtectedPage) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupLogout);
        } else {
            setupLogout();
        }
        verifyWithServer();
    }

    window.dashboardGuard = {
        isAuthenticated: isDashboardEnabled,
        protectedPages: PROTECTED_PAGES.slice(),
        defaultPage: DEFAULT_PAGE,
        safeRedirectTarget,
        readEnabled,
        writeEnabled,
        setupLogout
    };
})();
