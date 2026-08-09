/**
 * common-graph.js
 * Logique générique d'un graphe D3 interactif alimenté par le flux d'événements Socket.IO du
 * broker. Le comportement propre à chaque disposition (simulation, placement des nœuds, tracé des
 * liens) provient de `config`.
 */
function createGraph(config) {
    const {trackConnection, fetchJson, setConnectionState} = window.DashboardUtils;

    const svg = d3.select(config.svgSelector);
    const noeudSvg = svg.node();
    const rayon = 20;

    // Plafonne la taille du graphe. Chaque nom distinct mentionné par le broker devenait un nœud
    // permanent : sur un serveur de longue durée, on obtenait une pelote illisible qui saturait de
    // surcroît le processeur dans la simulation de forces.
    const MAX_NOEUDS = config.maxNodes || 80;

    // Les dimensions sont relues à chaque redimensionnement. Elles n'étaient auparavant mesurées
    // qu'une fois au démarrage : la disposition restait centrée sur la taille initiale de la
    // fenêtre et dérivait hors de l'écran au moindre redimensionnement — voire était calculée à
    // 0 × 0 si le conteneur n'avait pas encore été mis en page.
    let largeur = 0;
    let hauteur = 0;

    function mesurer() {
        const rect = noeudSvg.getBoundingClientRect();
        largeur = rect.width || noeudSvg.clientWidth || 800;
        hauteur = rect.height || noeudSvg.clientHeight || 600;
    }

    mesurer();

    const g = svg.append("g");
    const groupeLiens = g.append("g").attr("class", "links");
    const groupeNoeuds = g.append("g").attr("class", "nodes");

    // --- Pointes de flèches ------------------------------------------------------------------
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
        .style("fill", d => couleurLien(d));

    function couleurLien(type) {
        if (type === 'publish') return '#28a745';
        if (type === 'consume') return '#ffab40';
        return '#dc3545';
    }

    // --- Données -----------------------------------------------------------------------------
    let noeuds = [];
    const indexNoeuds = new Map();
    const simulation = config.createSimulation(largeur, hauteur);

    // Le glisser-déposer doit être défini avant que `mettreAJourGraphe()` puisse l'utiliser. Il
    // était auparavant déclaré avec `const` plus bas dans le fichier, ce qui ne fonctionnait que
    // grâce à l'ordre des appels.
    const glisser = d3.drag()
        .on("start", (evenement, d) => {
            if (!evenement.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on("drag", (evenement, d) => {
            d.fx = evenement.x;
            d.fy = evenement.y;
        })
        .on("end", (evenement) => {
            if (!evenement.active) simulation.alphaTarget(0);
            // On conserve délibérément fx/fy : cette disposition épingle tous les nœuds, si bien
            // que les effacer ici renvoyait le nœud déplacé au centre, sans jamais revenir sur
            // l'anneau.
        });

    /**
     * Insère ou rafraîchit un nœud. Renvoie true lorsque l'ensemble des nœuds a changé
     * (c'est-à-dire qu'un repositionnement s'impose).
     */
    function ajouterOuMettreAJourNoeud(id, role) {
        if (typeof id !== 'string' || id === '') return false;

        const existant = indexNoeuds.get(id);
        if (existant) {
            existant.vuLe = performance.now();
            if (!existant.roles.includes(role)) {
                existant.roles.push(role);
                return true;
            }
            return false;
        }

        const noeud = {id, name: id, roles: [role], vuLe: performance.now()};
        noeuds.push(noeud);
        indexNoeuds.set(id, noeud);

        // Évince les nœuds les moins récemment actifs dès que le budget est dépassé.
        if (noeuds.length > MAX_NOEUDS) {
            noeuds.sort((a, b) => b.vuLe - a.vuLe);
            for (const evince of noeuds.splice(MAX_NOEUDS)) {
                indexNoeuds.delete(evince.id);
            }
        }
        return true;
    }

    function dessinerFlecheTemporaire(idSource, idCible, type) {
        const noeudSource = indexNoeuds.get(idSource);
        const noeudCible = indexNoeuds.get(idCible);
        if (!noeudSource || !noeudCible) return;

        // Fait clignoter la destination pour qu'une rafale reste visible même lorsque la flèche
        // est courte.
        const elementCible = groupeNoeuds.selectAll('.node').filter(d => d.id === idCible);
        if (!elementCible.empty()) {
            elementCible.classed('blink', false);
            // Force un recalcul de mise en page pour que l'animation reparte en cas de tirs
            // répétés.
            void elementCible.node().getBoundingClientRect();
            elementCible.classed('blink', true);
            setTimeout(() => elementCible.classed('blink', false), 500);
        }

        const lienTemporaire = config.drawLink(groupeLiens, noeudSource, noeudCible, type);
        lienTemporaire.transition()
            .duration(2000)
            .style("opacity", 0)
            .remove();
    }

    function mettreAJourGraphe() {
        groupeNoeuds.selectAll(".node")
            .data(noeuds, d => d.id)
            .join(
                entrant => {
                    const noeudEntrant = entrant.append("g")
                        .attr("class", d => `node ${d.roles.join(' ')}`)
                        .call(glisser);
                    noeudEntrant.append("circle").attr("r", rayon);
                    noeudEntrant.append("text")
                        .attr("dy", ".35em")
                        .attr("y", rayon + 15)
                        .text(d => d.name);
                    return noeudEntrant;
                },
                miseAJour => miseAJour.attr("class", d => `node ${d.roles.join(' ')}`),
                // Les nœuds évincés restaient auparavant dans le DOM indéfiniment.
                sortant => sortant.remove()
            );

        simulation.nodes(noeuds);
    }

    function repositionner() {
        config.positionNodes(noeuds, largeur, hauteur);
        mettreAJourGraphe();
        simulation.alpha(0.3).restart();
    }

    simulation.on("tick", () => config.tickHandler(groupeNoeuds, groupeLiens));

    // --- Zoom --------------------------------------------------------------------------------
    const zoom = d3.zoom()
        .scaleExtent([0.2, 5])
        .on("zoom", (evenement) => g.attr("transform", evenement.transform));
    svg.call(zoom);

    // --- Redimensionnement -------------------------------------------------------------------
    if (typeof ResizeObserver === 'function') {
        let minuteurRedimensionnement = null;
        new ResizeObserver(() => {
            // Regroupement : un glissement de fenêtre déclenche cet événement en continu.
            if (minuteurRedimensionnement !== null) clearTimeout(minuteurRedimensionnement);
            minuteurRedimensionnement = setTimeout(() => {
                minuteurRedimensionnement = null;
                mesurer();
                const centre = simulation.force("center");
                if (centre) centre.x(largeur / 2).y(hauteur / 2);
                repositionner();
            }, 150);
        }).observe(noeudSvg);
    }

    // --- Initialisation ----------------------------------------------------------------------
    async function initialiserGraphe() {
        const etat = await fetchJson('/graph/state');

        const texteChargement = svg.select('#loading-text');
        if (!texteChargement.empty()) texteChargement.remove();

        // On protège chaque champ : une réponse partielle levait auparavant une exception à
        // l'intérieur du callback du socket et laissait la page bloquée sur
        // « En attente de données... ».
        (etat.producers || []).forEach(p => ajouterOuMettreAJourNoeud(p, 'producer'));
        (etat.topics || []).forEach(t => ajouterOuMettreAJourNoeud(t, 'topic'));
        (etat.consumers || []).forEach(c => ajouterOuMettreAJourNoeud(c, 'consumer'));

        mesurer();
        repositionner();
    }

    function traiterEvenement(donnees, type) {
        const {producer, topic, consumer} = donnees;
        let modifie = false;

        if (producer) modifie = ajouterOuMettreAJourNoeud(producer, 'producer') || modifie;
        if (topic) modifie = ajouterOuMettreAJourNoeud(topic, 'topic') || modifie;
        if (consumer) modifie = ajouterOuMettreAJourNoeud(consumer, 'consumer') || modifie;

        // On ne repositionne que si l'ensemble des nœuds a réellement changé. Le code précédent
        // relançait la simulation de forces à chaque événement, ce qui occupait le processeur en
        // charge sans le moindre gain visuel.
        if (modifie) repositionner();

        if (type === 'publish') dessinerFlecheTemporaire(producer, topic, 'publish');
        else if (type === 'consume') dessinerFlecheTemporaire(topic, consumer, 'consume');
        else if (type === 'consumed') dessinerFlecheTemporaire(topic, consumer, 'consumed');
    }

    function chargerEtat() {
        initialiserGraphe().catch(err => {
            console.error("Échec de l'initialisation du graphe :", err);
            setConnectionState('disconnected', 'état indisponible');
        });
    }

    const socket = trackConnection(io(), 'graphe');

    // Resynchronisation à chaque (re)connexion, plus un premier chargement immédiat pour que le
    // graphe affiche l'état courant même si le socket ne s'établit jamais.
    socket.on('connect', chargerEtat);
    chargerEtat();

    socket.on('new_message', (donnees) => traiterEvenement(donnees, 'publish'));
    socket.on('new_consumption', (donnees) => traiterEvenement(donnees, 'consume'));
    socket.on('consumed', (donnees) => traiterEvenement(donnees, 'consumed'));
    // La connexion d'un client n'est pas une consommation : on enregistre les nœuds sans tracer de
    // flèche de livraison, contrairement à l'ancienne correspondance `new_client -> consume`.
    socket.on('new_client', (donnees) => traiterEvenement(donnees, 'connect'));
}
