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

    const nav = document.createElement('nav');
    nav.className = 'navbar navbar-dark fixed-top';

    const container = document.createElement('div');
    container.className = 'container';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center';

    const brand = document.createElement('a');
    brand.className = 'navbar-brand';
    brand.href = '/control-panel.html';
    brand.textContent = '📊 Pub/Sub Monitor';
    left.appendChild(brand);

    const links = document.createElement('div');
    links.className = 'ms-4 d-flex gap-2';
    for (const item of navItems) {
        const link = document.createElement('a');
        link.className = item.href === currentPath ? 'nav-link active' : 'nav-link';
        link.href = item.href;
        link.textContent = item.label;
        if (item.href === currentPath) link.setAttribute('aria-current', 'page');
        links.appendChild(link);
    }
    left.appendChild(links);

    const right = document.createElement('div');
    right.className = 'd-flex align-items-center gap-3 ms-auto';

    // Live connection indicator, driven by DashboardUtils.setConnectionState().
    // Previously nothing on the page told you whether the event stream was alive, so a dead
    // socket looked exactly like an idle system.
    const status = document.createElement('span');
    status.id = 'connectionStatus';
    status.className = 'connection-status';
    status.dataset.state = 'connecting';
    status.textContent = 'Connexion…';
    right.appendChild(status);

    const logout = document.createElement('button');
    logout.className = 'btn btn-sm btn-outline-danger';
    logout.id = 'dashboardLogoutBtn';
    logout.type = 'button';
    logout.textContent = 'Logout';
    right.appendChild(logout);

    container.appendChild(left);
    container.appendChild(right);
    nav.appendChild(container);
    navContainer.replaceChildren(nav);

    // The guard registered its own DOMContentLoaded handler before this one, so at that point the
    // button did not exist yet. Tell it to bind now; setupLogout() is idempotent.
    if (window.dashboardGuard && typeof window.dashboardGuard.setupLogout === 'function') {
        window.dashboardGuard.setupLogout();
    }
});
