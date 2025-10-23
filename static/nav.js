document.addEventListener('DOMContentLoaded', function () {
    const navContainer = document.getElementById('main-header');
    if (!navContainer) return;

    const navItems = [
        {href: '/control-panel.html', label: 'Control Panel'},
        {href: '/activity-map.html', label: 'Activity Map'},
        {href: '/circular-graph.html', label: 'Circular Graph'}
    ];

    const currentPath = window.location.pathname;
    const currentItem = navItems.find(item => item.href === currentPath) || {label: 'Pub/Sub Monitor'};

    document.title = `${currentItem.label} - Pub/Sub Monitor`;

    const navLinksHTML = navItems.map(item => {
        const isActive = item.href === currentPath;
        return `<a class="nav-link ${isActive ? 'active' : ''}" href="${item.href}">${item.label}</a>`;
    }).join('');

    navContainer.innerHTML = `
        <nav class="navbar navbar-dark fixed-top">
            <div class="container" style="padding-left: 1.5rem; padding-right: 1.5rem;">
                <div class="d-flex align-items-center">
                    <a class="navbar-brand" href="/control-panel.html">📊 Pub/Sub Monitor</a>
                    <div class="ms-4 d-flex gap-2">${navLinksHTML}</div>
                </div>
                <button class="btn btn-sm btn-outline-danger" id="dashboardLogoutBtn" style="margin-left: auto;">Logout</button>
            </div>
        </nav>
    `;

    // On notifie le 'guard' que le bouton est prêt et qu'il peut y attacher l'action.
    if (window.dashboardGuard && typeof window.dashboardGuard.setupLogout === 'function') {
        window.dashboardGuard.setupLogout();
    }
});