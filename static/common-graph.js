/**
 * common-graph.js
 * This file contains the generic logic for creating an interactive D3 graph
 * updated via WebSockets. It is configurable for different types of layouts and renderings.
 */

// Export the main function to make it importable in other files.
/* export */
function createGraph(config) {
    // --- Socket.io and D3 initialization ---
    const socket = io();
    const svg = d3.select(config.svgSelector);
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const radius = 20;

    const g = svg.append("g");
    const linkGroup = g.append("g").attr("class", "links");
    const nodeGroup = g.append("g").attr("class", "nodes");

    // --- Arrow (Markers) definition ---
    // Configuration allows adjusting arrow tip position.
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
        .style("fill", d => d === 'publish' ? '#28a745' : d === 'consume' ? '#ffab40' : '#dc3545');
    /* .style("fill", d => d === 'publish' ? '#28a745' : '#ffab40'); */

    // --- Data and Simulation ---
    let nodes = [];
    const nodeMap = new Map();
    // Simulation is created using the function provided in configuration.
    const simulation = config.createSimulation(width, height);

    // --- Common functions ---

    function addOrUpdateNode(id, role) {
        let node = nodeMap.get(id);
        let isNewNode = false;
        if (!node) {
            node = {id, name: id, roles: [role]};
            nodes.push(node);
            nodeMap.set(id, node);
            isNewNode = true;
        } else if (!node.roles.includes(role)) {
            node.roles.push(role);
        }
        return isNewNode;
    }

    /* function drawTemporaryArrow(sourceId, targetId, type) {
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        if (!sourceNode || !targetNode) return;

        // Calls the link drawing function provided by configuration.
        const tempLink = config.drawLink(linkGroup, sourceNode, targetNode, type);

        tempLink.transition()
            .duration(2000)
            .style("opacity", 0)
            .remove();
    } */

    function drawTemporaryArrow(sourceId, targetId, type) {
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        if (!sourceNode || !targetNode) return;

        // --- ADDING BLINK EFFECT ---
        // 1. Select the target node group (<g>) using its ID.
        const targetNodeElement = nodeGroup.selectAll('.node')
            .filter(d => d.id === targetId);

        if (!targetNodeElement.empty()) {
            // 2. Add CSS class 'blink' to trigger the animation.
            targetNodeElement.classed('blink', true);

            // 3. Remove the class after 500ms so the effect can be replayed.
            setTimeout(() => {
                targetNodeElement.classed('blink', false);
            }, 500);
        }
        // --- END OF ADDITION ---

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
                        .call(drag(simulation));
                    nodeEnter.append("circle").attr("r", radius);
                    nodeEnter.append("text").attr("dy", ".35em").attr("y", radius + 15).text(d => d.name);
                    return nodeEnter;
                },
                update => update.attr("class", d => `node ${d.roles.join(' ')}`)
            );

        simulation.nodes(nodes);
        simulation.alpha(0.3).restart();
    }

    // The "tick" calls the specific tick function provided by configuration.
    simulation.on("tick", () => config.tickHandler(nodeGroup, linkGroup));

    // --- Interactivity (Zoom and Drag) ---

    const zoom = d3.zoom().on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const drag = simulation => {
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

        return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
    }

    // --- Initialization and WebSockets ---

    async function initializeGraph() {
        const response = await fetch('/graph/state');
        const state = await response.json();

        // Remove loading text if present
        const loadingText = svg.select('#loading-text');
        if (!loadingText.empty()) {
            loadingText.remove();
        }

        state.producers.forEach(p => addOrUpdateNode(p, 'producer'));
        state.topics.forEach(t => addOrUpdateNode(t, 'topic'));
        state.consumers.forEach(c => addOrUpdateNode(c, 'consumer'));

        // Calls the node positioning function from configuration.
        config.positionNodes(nodes, width, height);
        updateGraph();
    }

    function handleWebSocketEvent(data) {
        const {producer, topic, consumer} = data;
        let needsReposition = false;

        if (producer) needsReposition = addOrUpdateNode(producer, 'producer') || needsReposition;
        if (topic) needsReposition = addOrUpdateNode(topic, 'topic') || needsReposition;
        if (consumer) needsReposition = addOrUpdateNode(consumer, 'consumer') || needsReposition;

        if (data.type === 'publish') drawTemporaryArrow(producer, topic, 'publish');
        if (data.type === 'consume') drawTemporaryArrow(topic, consumer, 'consume');
        if (data.type === 'consumed') drawTemporaryArrow(topic, consumer, 'consumed');

        if (needsReposition) {
            config.positionNodes(nodes, width, height);
        }
        updateGraph();
    }

    socket.on('connect', () => console.log('Connected to activity stream.'));
    socket.on('new_message', (data) => handleWebSocketEvent({...data, type: 'publish'}));
    socket.on('new_consumption', (data) => handleWebSocketEvent({...data, type: 'consume'}));
    socket.on('new_client', (data) => handleWebSocketEvent({...data, type: 'consume'})); // Treated as new_consumption
    socket.on('consumed', (data) => handleWebSocketEvent({...data, type: 'consumed'}));

    // Launch initialization
    initializeGraph().catch(err => console.error('Failed to initialize graph:', err));
}