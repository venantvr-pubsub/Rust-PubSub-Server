/**
 * circular-graph.js
 * Configures and initializes a graph with a circular layout.
 */
// import { createGraph } from './common-graph.js';

document.addEventListener("DOMContentLoaded", () => {
    // Helper to calculate straight line path (not curved)
    function calculateStraightPath(source, target) {
        const radius = 20; // Circle radius
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance === 0) return "";

        // Calculate arrival point on target circle edge
        const targetX = target.x - (dx / distance) * radius;
        const targetY = target.y - (dy / distance) * radius;

        // Return straight line path (not curved)
        return `M${source.x},${source.y}L${targetX},${targetY}`;
    }

    // Circular graph specific configuration
    const circularGraphConfig = {
        svgSelector: "#activity-svg",
        arrow: {refX: 2, orient: "auto-start-reverse"},

        createSimulation: (width, height) => {
            return d3.forceSimulation()
                .force("charge", d3.forceManyBody().strength(-50))
                .force("center", d3.forceCenter(width / 2, height / 2))
                .alphaDecay(0.1)
                .velocityDecay(0.8);
        },

        positionNodes: (nodes, width, height) => {
            const numNodes = nodes.length;
            if (numNodes === 0) return;
            const angleStep = (2 * Math.PI) / numNodes;
            const circleRadius = Math.min(width, height) / 3;

            nodes.forEach((node, i) => {
                const angle = i * angleStep;
                // Fix position for a perfect circle
                node.fx = width / 2 + circleRadius * Math.cos(angle);
                node.fy = height / 2 + circleRadius * Math.sin(angle);
            });
        },

        drawLink: (linkGroup, sourceNode, targetNode, type) => {
            // Create a group for the arrow animation
            const arrowGroup = linkGroup.append("g")
                .datum({source: sourceNode, target: targetNode, type: type});

            // Draw the invisible base line (for path reference)
            const baseLine = arrowGroup.append("path")
                .attr("class", "base-line")
                .attr("d", calculateStraightPath(sourceNode, targetNode))
                .style("stroke", "none")
                .style("fill", "none");

            // Get the color based on type
            const arrowColor = type === 'publish' ? '#28a745' : type === 'consume' ? '#ffab40' : '#dc3545';

            // Create the animated arrow (small line with arrowhead)
            const animatedArrow = arrowGroup.append("path")
                .attr("class", `animated-arrow ${type}`)
                .attr("marker-end", `url(#arrow-${type})`)
                .style("stroke", arrowColor)
                .style("stroke-width", 2)
                .style("fill", "none");

            // Calculate the path length for animation
            const pathNode = baseLine.node();
            const pathLength = pathNode.getTotalLength();

            // Animate the arrow traveling along the path
            const animationDuration = 800; // 800ms for arrow to travel
            const arrowLength = 500; // Length of the visible arrow segment

            function animateArrow() {
                const startTime = Date.now();

                function frame() {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / animationDuration, 1);

                    // Calculate current position along the path
                    const currentLength = pathLength * progress;
                    const startPoint = Math.max(0, currentLength - arrowLength);
                    const endPoint = currentLength;

                    // Get points on the path
                    const start = pathNode.getPointAtLength(startPoint);
                    const end = pathNode.getPointAtLength(endPoint);

                    // Update the animated arrow path
                    animatedArrow.attr("d", `M${start.x},${start.y}L${end.x},${end.y}`);

                    if (progress < 1) {
                        requestAnimationFrame(frame);
                    }
                }

                requestAnimationFrame(frame);
            }

            // Start the animation
            animateArrow();

            return arrowGroup;
        },

        tickHandler: (nodeGroup, linkGroup) => {
            nodeGroup.selectAll('.node').attr("transform", d => `translate(${d.x},${d.y})`);
            // Update straight line paths at each tick
            linkGroup.selectAll('g').each(function (d) {
                const group = d3.select(this);
                const path = calculateStraightPath(d.source, d.target);
                group.select('.base-line').attr("d", path);
                // Note: animated arrow updates itself during animation
            });
        }
    };

    // Create graph with its configuration
    createGraph(circularGraphConfig);
});