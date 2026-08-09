document.addEventListener("DOMContentLoaded", () => {
    const {trackConnection, fetchJson, setConnectionState} = window.DashboardUtils;

    const svg = document.getElementById('map-svg');
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Per-column node budget. The map used to append a <div> for every distinct name it ever saw
    // and never removed one, so a long-running broker with rotating producer names grew the DOM
    // without bound and pushed everything off-screen. Columns are now capped and scroll.
    const MAX_NODES_PER_COLUMN = 60;

    // Cap on simultaneously animating arrows. Each arrow is an SVG element with a 1s lifetime; at
    // a few thousand messages/second the browser spends all its time creating and destroying them.
    const MAX_LIVE_ARROWS = 120;

    const columns = {
        producer: {el: document.getElementById('producers-col'), nodes: new Map()},
        topic: {el: document.getElementById('topics-col'), nodes: new Map()},
        consumer: {el: document.getElementById('consumers-col'), nodes: new Map()}
    };

    let liveArrows = 0;

    // --- Placeholders ------------------------------------------------------------------------
    function syncPlaceholder(type) {
        const column = columns[type];
        const existing = column.el.querySelector('.placeholder-text');
        if (column.nodes.size === 0) {
            if (!existing) {
                const placeholder = document.createElement('div');
                placeholder.className = 'placeholder-text';
                placeholder.textContent = 'En attente...';
                column.el.appendChild(placeholder);
            }
        } else if (existing) {
            existing.remove();
        }
    }

    // --- Nodes -------------------------------------------------------------------------------
    /**
     * Ensure a node exists in its column and return its element.
     * Nodes are keyed in a Map (not looked up by DOM id) so that names containing characters that
     * are awkward in selectors are handled, and so eviction is O(1).
     */
    function touchNode(name, type) {
        if (typeof name !== 'string' || name === '') return null;
        const column = columns[type];
        if (!column) return null;

        let el = column.nodes.get(name);
        if (el) {
            // Re-insert to move the entry to the most-recently-used end of the Map.
            column.nodes.delete(name);
            column.nodes.set(name, el);
            return el;
        }

        el = document.createElement('div');
        el.className = 'node';
        el.textContent = name;
        el.title = name;
        column.el.appendChild(el);
        column.nodes.set(name, el);

        // Evict the least recently active node once the column is full.
        while (column.nodes.size > MAX_NODES_PER_COLUMN) {
            const oldestKey = column.nodes.keys().next().value;
            const oldest = column.nodes.get(oldestKey);
            column.nodes.delete(oldestKey);
            if (oldest) oldest.remove();
        }

        syncPlaceholder(type);
        return el;
    }

    function removeNode(name, type) {
        const column = columns[type];
        if (!column) return;
        const el = column.nodes.get(name);
        if (!el) return;
        column.nodes.delete(name);
        el.remove();
        syncPlaceholder(type);
    }

    function pulse(el) {
        if (!el) return;
        el.classList.remove('active');
        // Force a reflow so the animation restarts when the same node fires twice in a row.
        void el.offsetWidth;
        el.classList.add('active');
    }

    // --- Arrows ------------------------------------------------------------------------------
    function drawArrow(startEl, endEl, arrowType) {
        if (!startEl || !endEl) return;
        if (liveArrows >= MAX_LIVE_ARROWS) return;

        const mapRect = svg.getBoundingClientRect();
        const startRect = startEl.getBoundingClientRect();
        const endRect = endEl.getBoundingClientRect();

        // Skip arrows whose endpoints have scrolled out of the visible map area; drawing them
        // produces stray lines pinned to the container edges.
        if (startRect.bottom < mapRect.top || startRect.top > mapRect.bottom) return;
        if (endRect.bottom < mapRect.top || endRect.top > mapRect.bottom) return;

        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(startRect.right - mapRect.left));
        line.setAttribute('y1', String(startRect.top + startRect.height / 2 - mapRect.top));
        line.setAttribute('x2', String(endRect.left - mapRect.left));
        line.setAttribute('y2', String(endRect.top + endRect.height / 2 - mapRect.top));
        line.setAttribute('class', `message-arrow ${arrowType}`);
        line.setAttribute('marker-end', `url(#arrowhead-${arrowType})`);

        svg.appendChild(line);
        liveArrows++;

        // `line.remove()` is a no-op if the node is already detached, unlike svg.removeChild(line)
        // which throws NotFoundError.
        setTimeout(() => {
            line.remove();
            liveArrows--;
        }, 1000);
    }

    // --- Arrowhead markers -------------------------------------------------------------------
    function buildMarkers() {
        const defs = document.createElementNS(SVG_NS, 'defs');
        const markers = [
            {id: 'arrowhead-publish', fill: '#22c55e'},
            {id: 'arrowhead-consume', fill: '#ffab40'},
            {id: 'arrowhead-consumed', fill: '#ef4444'}
        ];

        for (const {id, fill} of markers) {
            const marker = document.createElementNS(SVG_NS, 'marker');
            marker.setAttribute('id', id);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '8');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto-start-reverse');
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            path.setAttribute('fill', fill);
            marker.appendChild(path);
            defs.appendChild(marker);
        }
        svg.appendChild(defs);
    }

    // --- Initial state -----------------------------------------------------------------------
    async function initializeActivityMap() {
        try {
            const state = await fetchJson('/graph/state');
            // Defensive: a partial or errored response must not take the page down.
            (state.producers || []).forEach(p => touchNode(p, 'producer'));
            (state.topics || []).forEach(t => touchNode(t, 'topic'));
            (state.consumers || []).forEach(c => touchNode(c, 'consumer'));
        } catch (error) {
            console.error('Failed to initialize activity map:', error);
            setConnectionState('disconnected', 'état indisponible');
        }
    }

    // --- Wiring ------------------------------------------------------------------------------
    buildMarkers();
    for (const type of Object.keys(columns)) syncPlaceholder(type);

    const socket = trackConnection(io(), 'activity');

    socket.on('connect', () => {
        // Re-sync on every (re)connect: anything that happened while disconnected was missed.
        initializeActivityMap();
    });

    socket.on('new_message', (data) => {
        const producer = touchNode(data.producer, 'producer');
        const topic = touchNode(data.topic, 'topic');
        pulse(topic);
        drawArrow(producer, topic, 'publish');
    });

    socket.on('new_consumption', (data) => {
        const topic = touchNode(data.topic, 'topic');
        const consumer = touchNode(data.consumer, 'consumer');
        pulse(consumer);
        drawArrow(topic, consumer, 'consume');
    });

    socket.on('consumed', (data) => {
        const topic = touchNode(data.topic, 'topic');
        const consumer = touchNode(data.consumer, 'consumer');
        pulse(consumer);
        drawArrow(topic, consumer, 'consumed');
    });

    socket.on('new_client', (data) => {
        touchNode(data.consumer, 'consumer');
        touchNode(data.topic, 'topic');
    });

    // Drop consumers that go away, so the map reflects who is actually connected.
    socket.on('client_disconnected', (data) => {
        removeNode(data.consumer, 'consumer');
    });
});
