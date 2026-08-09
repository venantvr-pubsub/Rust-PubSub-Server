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
    nav.className = 'navbar navbar-dark';

    const container = document.createElement('div');
    container.className = 'container';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center flex-wrap gap-2';

    const brand = document.createElement('a');
    brand.className = 'navbar-brand';
    brand.href = '/control-panel.html';
    brand.textContent = '📊 Pub/Sub Monitor';
    left.appendChild(brand);

    const links = document.createElement('div');
    links.className = 'd-flex gap-2 flex-wrap';
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

    // Indicateur de connexion en direct, piloté par DashboardUtils.setConnectionState().
    // Auparavant, rien sur la page n'indiquait si le flux d'événements était vivant : un socket
    // mort ressemblait exactement à un système au repos.
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

    // La garde a enregistré son propre gestionnaire DOMContentLoaded avant celui-ci : à ce
    // moment-là, le bouton n'existait pas encore. On lui demande donc de s'attacher maintenant ;
    // setupLogout() est idempotente.
    if (window.dashboardGuard && typeof window.dashboardGuard.setupLogout === 'function') {
        window.dashboardGuard.setupLogout();
    }
});
