/**
 * common-graph.js
 * Generic logic for an interactive D3 graph fed by the broker's Socket.IO event stream.
 * Layout-specific behaviour (simulation, node placement, link drawing) comes from `config`.
 */
function createGraph(config) {
    const {trackConnection, fetchJson, setConnectionState} = window.DashboardUtils;

    const svg = d3.select(config.svgSelector);
    const svgNode = svg.node();
    const radius = 20;

    // Cap the graph size. Every distinct name the broker ever mentions used to become a permanent
    // node, so a long-running server ended up with an unreadable hairball that also pegged the CPU
    // in the force simulation.
    const MAX_NODES = config.maxNodes || 80;

    // Dimensions are re-read on resize. They used to be captured once at startup, so the layout
    // stayed centred on the initial window size and drifted off-screen after any resize - and was
    // computed as 0x0 entirely if the container had not been laid out yet.
    let width = 0;
    let height = 0;

    function measure() {
        const rect = svgNode.getBoundingClientRect();
        width = rect.width || svgNode.clientWidth || 800;
        height = rect.height || svgNode.clientHeight || 600;
    }

    measure();

    const g = svg.append("g");
    const linkGroup = g.append("g").attr("class", "links");
    const nodeGroup = g.append("g").attr("class", "nodes");

    // --- Arrow markers -----------------------------------------------------------------------
    svg.append("defs").selectAll("marker")
        .data(["publish", "consume", "consumed"])
        .enter().append("marker")
        .attr("id", d => `arrow-${d}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", config.arrow.refX)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", config.arrow.orient)
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .style("fill", d => linkColor(d));

    function linkColor(type) {
        if (type === 'publish') return '#28a745';
        if (type === 'consume') return '#ffab40';
        return '#dc3545';
    }

    // --- Data --------------------------------------------------------------------------------
    let nodes = [];
    const nodeMap = new Map();
    const simulation = config.createSimulation(width, height);

    // Drag must be defined before updateGraph() can call it. It was previously declared with
    // `const` further down the file, which worked only because of call ordering.
    const drag = d3.drag()
        .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
        })
        .on("end", (event) => {
            if (!event.active) simulation.alphaTarget(0);
            // Deliberately keep fx/fy: this layout pins every node, so clearing them here made a
            // dragged node snap to the centre and never return to the ring.
        });

    /**
     * Insert or refresh a node. Returns true when the node set changed (i.e. a relayout is due).
     */
    function addOrUpdateNode(id, role) {
        if (typeof id !== 'string' || id === '') return false;

        const existing = nodeMap.get(id);
        if (existing) {
            existing.lastSeen = performance.now();
            if (!existing.roles.includes(role)) {
                existing.roles.push(role);
                return true;
            }
            return false;
        }

        const node = {id, name: id, roles: [role], lastSeen: performance.now()};
        nodes.push(node);
        nodeMap.set(id, node);

        // Evict the least recently active nodes once we exceed the budget.
        if (nodes.length > MAX_NODES) {
            nodes.sort((a, b) => b.lastSeen - a.lastSeen);
            for (const dropped of nodes.splice(MAX_NODES)) {
                nodeMap.delete(dropped.id);
            }
        }
        return true;
    }

    function drawTemporaryArrow(sourceId, targetId, type) {
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        if (!sourceNode || !targetNode) return;

        // Blink the destination so a burst is visible even when the arrow is short.
        const targetNodeElement = nodeGroup.selectAll('.node').filter(d => d.id === targetId);
        if (!targetNodeElement.empty()) {
            targetNodeElement.classed('blink', false);
            // Force a reflow so the animation restarts on repeated hits.
            void targetNodeElement.node().getBoundingClientRect();
            targetNodeElement.classed('blink', true);
            setTimeout(() => targetNodeElement.classed('blink', false), 500);
        }

        const tempLink = config.drawLink(linkGroup, sourceNode, targetNode, type);
        tempLink.transition()
            .duration(2000)
            .style("opacity", 0)
            .remove();
    }

    function updateGraph() {
        nodeGroup.selectAll(".node")
            .data(nodes, d => d.id)
            .join(
                enter => {
                    const nodeEnter = enter.append("g")
                        .attr("class", d => `node ${d.roles.join(' ')}`)
                        .call(drag);
                    nodeEnter.append("circle").attr("r", radius);
                    nodeEnter.append("text")
                        .attr("dy", ".35em")
                        .attr("y", radius + 15)
                        .text(d => d.name);
                    return nodeEnter;
                },
                update => update.attr("class", d => `node ${d.roles.join(' ')}`),
                // Evicted nodes were previously left in the DOM forever.
                exit => exit.remove()
            );

        simulation.nodes(nodes);
    }

    function relayout() {
        config.positionNodes(nodes, width, height);
        updateGraph();
        simulation.alpha(0.3).restart();
    }

    simulation.on("tick", () => config.tickHandler(nodeGroup, linkGroup));

    // --- Zoom --------------------------------------------------------------------------------
    const zoom = d3.zoom()
        .scaleExtent([0.2, 5])
        .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // --- Resize ------------------------------------------------------------------------------
    if (typeof ResizeObserver === 'function') {
        let resizeTimer = null;
        new ResizeObserver(() => {
            // Coalesce: a window drag fires this continuously.
            if (resizeTimer !== null) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeTimer = null;
                measure();
                const center = simulation.force("center");
                if (center) center.x(width / 2).y(height / 2);
                relayout();
            }, 150);
        }).observe(svgNode);
    }

    // --- Initialization ----------------------------------------------------------------------
    async function initializeGraph() {
        const state = await fetchJson('/graph/state');

        const loadingText = svg.select('#loading-text');
        if (!loadingText.empty()) loadingText.remove();

        // Guard every field: a partial response used to throw inside the socket callback and
        // leave the page stuck on "En attente de données...".
        (state.producers || []).forEach(p => addOrUpdateNode(p, 'producer'));
        (state.topics || []).forEach(t => addOrUpdateNode(t, 'topic'));
        (state.consumers || []).forEach(c => addOrUpdateNode(c, 'consumer'));

        measure();
        relayout();
    }

    function handleEvent(data, type) {
        const {producer, topic, consumer} = data;
        let changed = false;

        if (producer) changed = addOrUpdateNode(producer, 'producer') || changed;
        if (topic) changed = addOrUpdateNode(topic, 'topic') || changed;
        if (consumer) changed = addOrUpdateNode(consumer, 'consumer') || changed;

        // Only relayout when the node set actually changed. The previous code restarted the force
        // simulation on every single event, which kept the CPU busy under load for no visual gain.
        if (changed) relayout();

        if (type === 'publish') drawTemporaryArrow(producer, topic, 'publish');
        else if (type === 'consume') drawTemporaryArrow(topic, consumer, 'consume');
        else if (type === 'consumed') drawTemporaryArrow(topic, consumer, 'consumed');
    }

    function loadState() {
        initializeGraph().catch(err => {
            console.error('Failed to initialize graph:', err);
            setConnectionState('disconnected', 'état indisponible');
        });
    }

    const socket = trackConnection(io(), 'graph');

    // Re-sync on every (re)connect, and once up front so the graph still renders the current
    // state if the socket never comes up.
    socket.on('connect', loadState);
    loadState();

    socket.on('new_message', (data) => handleEvent(data, 'publish'));
    socket.on('new_consumption', (data) => handleEvent(data, 'consume'));
    socket.on('consumed', (data) => handleEvent(data, 'consumed'));
    // A client connecting is not a consumption: register the nodes but do not draw a delivery
    // arrow for it, which is what the old `new_client -> consume` mapping did.
    socket.on('new_client', (data) => handleEvent(data, 'connect'));
}
