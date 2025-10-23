document.addEventListener("DOMContentLoaded", () => {
    const socket = io();
    const producersCol = document.getElementById('producers-col');
    const topicsCol = document.getElementById('topics-col');
    const consumersCol = document.getElementById('consumers-col');
    const svg = document.getElementById('map-svg');

    const nodes = new Set();

    // Add "En attente..." placeholder to each column
    const addPlaceholder = (column, type) => {
        const placeholderId = `placeholder-${type}`;
        const placeholder = document.createElement('div');
        placeholder.id = placeholderId;
        placeholder.className = 'placeholder-text';
        placeholder.textContent = 'En attente...';
        column.appendChild(placeholder);
    };

    // Remove placeholder when first node is added
    const removePlaceholder = (column, type) => {
        const placeholderId = `placeholder-${type}`;
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) {
            placeholder.remove();
        }
    };

    // Initialize placeholders
    addPlaceholder(producersCol, 'producer');
    addPlaceholder(topicsCol, 'topic');
    addPlaceholder(consumersCol, 'consumer');

    /**
     * Draw a node in the specified column
     * @param {string} name - Node name
     * @param {string} type - Node type (producer/topic/consumer)
     * @param {HTMLElement} column - Column element
     * @returns {string} - Node ID
     */
    const drawNode = (name, type, column) => {
        const nodeId = `node-${type}-${name}`;
        if (!nodes.has(nodeId)) {
            // Remove placeholder when adding first node
            removePlaceholder(column, type);

            nodes.add(nodeId);
            const nodeEl = document.createElement('div');
            nodeEl.id = nodeId;
            nodeEl.className = 'node';
            nodeEl.textContent = name;
            column.appendChild(nodeEl);
        }
        return nodeId;
    };

    /**
     * Draw an arrow between two nodes
     * @param {string} startId - Start node ID
     * @param {string} endId - End node ID
     * @param {string} arrowType - Arrow type (publish/consume)
     */
    const drawArrow = (startId, endId, arrowType = 'consume') => {
        const startEl = document.getElementById(startId);
        const endEl = document.getElementById(endId);
        if (!startEl || !endEl) return;

        const mapRect = svg.getBoundingClientRect();
        const startRect = startEl.getBoundingClientRect();
        const endRect = endEl.getBoundingClientRect();

        const startX = startRect.right - mapRect.left;
        const startY = startRect.top + startRect.height / 2 - mapRect.top;
        const endX = endRect.left - mapRect.left;
        const endY = endRect.top + endRect.height / 2 - mapRect.top;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', endX);
        line.setAttribute('y2', endY);
        line.setAttribute('class', `message-arrow ${arrowType}`);

        // Add arrowhead marker based on type
        line.setAttribute('marker-end', `url(#arrowhead-${arrowType})`);

        svg.appendChild(line);

        setTimeout(() => {
            svg.removeChild(line);
        }, 1000); // Remove after 1 second animation
    };

    // Define arrowhead markers in SVG
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Publish arrowhead (green)
    const markerPublish = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    markerPublish.setAttribute('id', 'arrowhead-publish');
    markerPublish.setAttribute('viewBox', '0 0 10 10');
    markerPublish.setAttribute('refX', '8');
    markerPublish.setAttribute('refY', '5');
    markerPublish.setAttribute('markerWidth', '6');
    markerPublish.setAttribute('markerHeight', '6');
    markerPublish.setAttribute('orient', 'auto-start-reverse');
    const pathPublish = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathPublish.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    pathPublish.setAttribute('fill', '#28a745');
    markerPublish.appendChild(pathPublish);
    defs.appendChild(markerPublish);

    // Consume arrowhead (orange)
    const markerConsume = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    markerConsume.setAttribute('id', 'arrowhead-consume');
    markerConsume.setAttribute('viewBox', '0 0 10 10');
    markerConsume.setAttribute('refX', '8');
    markerConsume.setAttribute('refY', '5');
    markerConsume.setAttribute('markerWidth', '6');
    markerConsume.setAttribute('markerHeight', '6');
    markerConsume.setAttribute('orient', 'auto-start-reverse');
    const pathConsume = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathConsume.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    pathConsume.setAttribute('fill', '#ffab40');
    markerConsume.appendChild(pathConsume);
    defs.appendChild(markerConsume);

    svg.appendChild(defs);


    socket.on('connect', () => {
        console.log('Connected to activity stream.');
    });

    socket.on('new_message', (data) => {
        console.log('New Message:', data);
        const producerId = drawNode(data.producer, 'producer', producersCol);
        const topicId = drawNode(data.topic, 'topic', topicsCol);
        drawArrow(producerId, topicId, 'publish');
    });

    socket.on('new_consumption', (data) => {
        console.log('New Consumption:', data);
        const topicId = drawNode(data.topic, 'topic', topicsCol);
        const consumerId = drawNode(data.consumer, 'consumer', consumersCol);
        drawArrow(topicId, consumerId);
    });

    socket.on('new_client', (data) => {
        // Pre-draw consumer nodes when they connect
        drawNode(data.consumer, 'consumer', consumersCol);
    });

    socket.on('consumed', (data) => {
        console.log('Consumed:', data);
        const topicId = drawNode(data.topic, 'topic', topicsCol);
        const consumerId = drawNode(data.consumer, 'consumer', consumersCol);
        drawArrow(topicId, consumerId, 'consume');
    });
});