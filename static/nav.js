document.addEventListener('DOMContentLoaded', function () {
    const navItems = [
        {href: '/control-panel.html', label: 'Control Panel'},
        {href: '/activity-map.html', label: 'Activity Map'},
        {href: '/circular-graph.html', label: 'Circular Graph'}
    ];

    const currentPath = window.location.pathname;
    const currentItem = navItems.find(item => item.href === currentPath);

    if (currentItem) {
        document.title = currentItem.label + ' - Pub/Sub Monitor';
    }

    const navbarNav = document.querySelector('.navbar-nav');
    if (navbarNav) {
        navbarNav.innerHTML = '';

        navItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'nav-item';

            const a = document.createElement('a');
            a.className = 'nav-link';
            a.href = item.href;
            a.textContent = item.label;

            if (item.href === currentPath) {
                a.classList.add('active');
                a.setAttribute('aria-current', 'page');
            }

            li.appendChild(a);
            navbarNav.appendChild(li);
        });
    }

    const h1 = document.querySelector('h1');
    if (h1 && currentItem) {
        h1.textContent = currentItem.label;
    }
});