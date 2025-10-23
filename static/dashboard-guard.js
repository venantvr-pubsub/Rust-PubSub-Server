// Dashboard Guard - Intercepts page access and redirects to login if not authenticated
// This script should be included FIRST in all protected dashboard pages

(function () {
    'use strict';

    // Check if dashboard is enabled
    const isDashboardEnabled = localStorage.getItem('dashboardEnabled') === 'true';

    // Get current page path
    const currentPath = window.location.pathname;

    // Pages that require authentication
    const protectedPages = [
        '/control-panel.html',
        '/activity-map.html',
        '/circular-graph.html'
    ];

    // Check if current page is protected
    const isProtectedPage = protectedPages.some(page => currentPath.endsWith(page));

    // If accessing a protected page without authentication, redirect to login
    if (isProtectedPage && !isDashboardEnabled) {
        // Store the intended destination
        const redirectUrl = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
        window.location.replace(redirectUrl);
        // Prevent further script execution
        throw new Error('Redirecting to login page');
    }

    // If authenticated, set up logout functionality
    if (isDashboardEnabled && isProtectedPage) {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupLogout);
        } else {
            setupLogout();
        }
    }

    function setupLogout() {
        const logoutBtn = document.getElementById('dashboardLogoutBtn');
        if (!logoutBtn) return;

        logoutBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/dashboard/logout', {method: 'POST'});
                const data = await response.json();

                if (data.status === 'ok') {
                    localStorage.setItem('dashboardEnabled', 'false');
                    console.log('Dashboard disabled');
                    // Redirect to login page
                    window.location.href = '/login.html';
                }
            } catch (error) {
                console.error('Logout error:', error);
                // Still redirect to login page even on error
                localStorage.setItem('dashboardEnabled', 'false');
                window.location.href = '/login.html';
            }
        });
    }

    // Export guard status for other scripts
    window.dashboardGuard = {
        isAuthenticated: isDashboardEnabled,
        // La fonction qui attache l'événement au bouton est maintenant accessible ici
        setupLogout: setupLogout,
        logout: function () {
            const event = new Event('click');
            const btn = document.getElementById('dashboardLogoutBtn');
            if (btn) btn.dispatchEvent(event);
        }
    };
})();