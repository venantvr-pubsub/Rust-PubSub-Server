/**
 * circular-graph.js
 * Configure et initialise un graphe à disposition circulaire.
 */

document.addEventListener("DOMContentLoaded", () => {
    // Calcule le chemin d'une ligne droite (et non courbe).
    function calculerCheminDroit(source, cible) {
        const rayon = 20; // Rayon des cercles représentant les nœuds.
        const dx = cible.x - source.x;
        const dy = cible.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance === 0) return "";

        // Calcule le point d'arrivée sur le bord du cercle cible.
        const cibleX = cible.x - (dx / distance) * rayon;
        const cibleY = cible.y - (dy / distance) * rayon;

        return `M${source.x},${source.y}L${cibleX},${cibleY}`;
    }

    // Configuration spécifique au graphe circulaire.
    const configurationGrapheCirculaire = {
        svgSelector: "#activity-svg",
        arrow: {refX: 2, orient: "auto-start-reverse"},

        createSimulation: (largeur, hauteur) => {
            return d3.forceSimulation()
                .force("charge", d3.forceManyBody().strength(-50))
                .force("center", d3.forceCenter(largeur / 2, hauteur / 2))
                .alphaDecay(0.1)
                .velocityDecay(0.8);
        },

        positionNodes: (noeuds, largeur, hauteur) => {
            const nombreNoeuds = noeuds.length;
            if (nombreNoeuds === 0) return;
            const pasAngulaire = (2 * Math.PI) / nombreNoeuds;
            const rayonCercle = Math.min(largeur, hauteur) / 3;

            noeuds.forEach((noeud, i) => {
                const angle = i * pasAngulaire;
                // Position figée pour obtenir un cercle parfait.
                noeud.fx = largeur / 2 + rayonCercle * Math.cos(angle);
                noeud.fy = hauteur / 2 + rayonCercle * Math.sin(angle);
            });
        },

        drawLink: (groupeLiens, noeudSource, noeudCible, type) => {
            // Groupe dédié à l'animation de la flèche.
            const groupeFleche = groupeLiens.append("g")
                .datum({source: noeudSource, target: noeudCible, type: type});

            // Trace la ligne de base invisible, qui sert de chemin de référence.
            const ligneBase = groupeFleche.append("path")
                .attr("class", "base-line")
                .attr("d", calculerCheminDroit(noeudSource, noeudCible))
                .style("stroke", "none")
                .style("fill", "none");

            // Couleur en fonction du type d'événement.
            const couleurFleche = type === 'publish' ? '#28a745' : type === 'consume' ? '#ffab40' : '#dc3545';

            // Flèche animée (court segment terminé par une pointe).
            const flecheAnimee = groupeFleche.append("path")
                .attr("class", `animated-arrow ${type}`)
                .attr("marker-end", `url(#arrow-${type})`)
                .style("stroke", couleurFleche)
                .style("stroke-width", 2)
                .style("fill", "none");

            // Longueur du chemin, nécessaire à l'animation.
            const noeudChemin = ligneBase.node();
            const longueurChemin = noeudChemin.getTotalLength();

            // Un chemin de longueur nulle (source et cible au même point) n'offre aucun point à
            // échantillonner : `getPointAtLength` n'aurait aucun sens et la flèche serait de toute
            // façon invisible.
            if (!(longueurChemin > 0)) return groupeFleche;

            // Animation du déplacement de la flèche le long du chemin.
            const dureeAnimation = 800; // 800 ms pour parcourir le chemin.
            // Longueur du segment visible. C'était auparavant une valeur fixe de 500 px, bien
            // supérieure à n'importe quelle corde du cercle de disposition : la flèche
            // « voyageuse » n'était donc en réalité qu'un trait qui s'allongeait depuis le nœud
            // source, sans jamais s'en détacher. On la met à l'échelle du chemin, avec un plancher
            // pour que les liens très courts restent visibles.
            const longueurFleche = Math.max(24, longueurChemin * 0.25);

            function animerFleche() {
                const instantDepart = performance.now();

                function image(maintenant) {
                    const ecoule = maintenant - instantDepart;
                    const progression = Math.min(ecoule / dureeAnimation, 1);

                    // Position courante le long du chemin.
                    const longueurCourante = longueurChemin * progression;
                    const pointDepart = Math.max(0, longueurCourante - longueurFleche);
                    const pointArrivee = longueurCourante;

                    const debut = noeudChemin.getPointAtLength(pointDepart);
                    const fin = noeudChemin.getPointAtLength(pointArrivee);

                    flecheAnimee.attr("d", `M${debut.x},${debut.y}L${fin.x},${fin.y}`);

                    if (progression < 1) {
                        requestAnimationFrame(image);
                    }
                }

                requestAnimationFrame(image);
            }

            animerFleche();

            return groupeFleche;
        },

        tickHandler: (groupeNoeuds, groupeLiens) => {
            groupeNoeuds.selectAll('.node')
                .attr("transform", d => `translate(${d.x || 0},${d.y || 0})`);
            // Met à jour les chemins rectilignes à chaque battement de la simulation.
            groupeLiens.selectAll('g').each(function (d) {
                // Les groupes créés hors de `drawLink` ne portent pas de donnée : on les ignore
                // plutôt que de lever une exception.
                if (!d || !d.source || !d.target) return;
                const groupe = d3.select(this);
                groupe.select('.base-line').attr("d", calculerCheminDroit(d.source, d.target));
                // Remarque : la flèche animée se met à jour d'elle-même pendant l'animation.
            });
        }
    };

    // Crée le graphe à partir de sa configuration.
    createGraph(configurationGrapheCirculaire);
});
