/**
 * circular-graph.js
 * Configure et initialise un graphe à disposition circulaire.
 *
 * Le tracé des liens n'est pas une simple droite ni un arc arbitraire : il est **routé**.
 * Le chemin quitte le nœud source perpendiculairement à sa circonférence, contourne les nœuds
 * qui se trouvent en travers en les prenant comme balises, puis aborde le nœud cible
 * perpendiculairement lui aussi. Les angles du parcours sont adoucis par des congés.
 */

document.addEventListener("DOMContentLoaded", () => {
    const RAYON_NOEUD = 20;
    // Distance à laquelle le chemin passe du centre d'un nœud contourné. Au-delà du rayon du
    // nœud, il faut de quoi loger le trait et son étiquette sans que ça paraisse frôlé.
    const DEGAGEMENT = RAYON_NOEUD + 26;
    // Longueur du segment d'amorce qui garantit une sortie — et une entrée — perpendiculaires.
    const AMORCE = 28;
    // Rayon maximal des congés adoucissant les angles du parcours.
    const CONGE = 34;

    const norme = (x, y) => Math.hypot(x, y);

    /**
     * Cherche les nœuds qui barrent la route entre `source` et `cible`, et produit pour chacun
     * une balise : un point de passage décalé du côté opposé, à `DEGAGEMENT` de l'axe.
     *
     * @returns {Array<{t:number, x:number, y:number}>} balises ordonnées le long du trajet
     */
    function calculerBalises(source, cible, noeuds) {
        const ax = source.x, ay = source.y;
        const longueur = norme(cible.x - ax, cible.y - ay);
        if (!(longueur > 0)) return [];

        // Vecteur unitaire le long de l'axe, et sa normale.
        const ux = (cible.x - ax) / longueur;
        const uy = (cible.y - ay) / longueur;
        const nx = -uy;
        const ny = ux;

        const balises = [];
        for (const noeud of noeuds) {
            if (noeud === source || noeud === cible) continue;
            if (typeof noeud.x !== 'number' || typeof noeud.y !== 'number') continue;

            const dx = noeud.x - ax;
            const dy = noeud.y - ay;

            // Projection sur l'axe : à quelle distance du départ le nœud se situe-t-il ?
            const t = dx * ux + dy * uy;
            // Hors du segment (derrière le départ ou après l'arrivée) : il ne gêne pas.
            if (t <= RAYON_NOEUD || t >= longueur - RAYON_NOEUD) continue;

            // Écart signé par rapport à l'axe : le signe indique de quel côté il se trouve.
            const ecart = dx * nx + dy * ny;
            if (Math.abs(ecart) >= DEGAGEMENT) continue; // assez loin, rien à contourner

            // On passe du côté opposé au nœud. À écart nul, le choix est arbitraire mais stable.
            const cote = ecart >= 0 ? -1 : 1;
            balises.push({
                t,
                x: ax + ux * t + nx * cote * DEGAGEMENT,
                y: ay + uy * t + ny * cote * DEGAGEMENT
            });
        }

        balises.sort((a, b) => a.t - b.t);
        return balises;
    }

    /**
     * Construit la suite de points du parcours, amorces perpendiculaires comprises.
     */
    function calculerParcours(source, cible, noeuds) {
        const balises = calculerBalises(source, cible, noeuds);

        // La direction de sortie vise la première balise — ou directement la cible s'il n'y en a
        // aucune. C'est elle qui fixe le point de sortie sur la circonférence, donc la
        // perpendiculaire.
        const premier = balises.length ? balises[0] : cible;
        const dernier = balises.length ? balises[balises.length - 1] : source;

        const sortie = direction(source, premier);
        const entree = direction(cible, dernier);
        if (!sortie || !entree) return null;

        return [
            // Point de sortie sur la circonférence du nœud source, puis amorce dans l'axe du
            // rayon : les deux premiers points sont alignés sur la normale, donc le départ est
            // perpendiculaire au nœud.
            {x: source.x + sortie.x * RAYON_NOEUD, y: source.y + sortie.y * RAYON_NOEUD},
            {x: source.x + sortie.x * (RAYON_NOEUD + AMORCE), y: source.y + sortie.y * (RAYON_NOEUD + AMORCE)},
            ...balises,
            // Symétriquement côté cible : amorce puis point d'entrée, alignés sur son rayon.
            {x: cible.x + entree.x * (RAYON_NOEUD + AMORCE), y: cible.y + entree.y * (RAYON_NOEUD + AMORCE)},
            {x: cible.x + entree.x * RAYON_NOEUD, y: cible.y + entree.y * RAYON_NOEUD}
        ];
    }

    /** Vecteur unitaire de `depuis` vers `vers`, ou null si les deux points sont confondus. */
    function direction(depuis, vers) {
        const dx = vers.x - depuis.x;
        const dy = vers.y - depuis.y;
        const d = norme(dx, dy);
        if (!(d > 0)) return null;
        return {x: dx / d, y: dy / d};
    }

    /**
     * Transforme une ligne brisée en chemin adouci : chaque sommet devient un congé quadratique.
     * Le rayon est borné par la moitié du plus court des deux segments adjacents, pour qu'un
     * virage serré ne déborde jamais sur le suivant.
     */
    function cheminAdouci(points, rayonMax) {
        if (!points || points.length < 2) return '';

        let d = `M${points[0].x},${points[0].y}`;

        for (let i = 1; i < points.length - 1; i++) {
            const precedent = points[i - 1];
            const sommet = points[i];
            const suivant = points[i + 1];

            const v1 = {x: precedent.x - sommet.x, y: precedent.y - sommet.y};
            const v2 = {x: suivant.x - sommet.x, y: suivant.y - sommet.y};
            const l1 = norme(v1.x, v1.y);
            const l2 = norme(v2.x, v2.y);
            // Sommet confondu avec un voisin : pas de virage à adoucir.
            if (!(l1 > 0) || !(l2 > 0)) continue;

            const rayon = Math.min(rayonMax, l1 / 2, l2 / 2);
            const avant = {x: sommet.x + (v1.x / l1) * rayon, y: sommet.y + (v1.y / l1) * rayon};
            const apres = {x: sommet.x + (v2.x / l2) * rayon, y: sommet.y + (v2.y / l2) * rayon};

            d += `L${avant.x},${avant.y}Q${sommet.x},${sommet.y} ${apres.x},${apres.y}`;
        }

        const fin = points[points.length - 1];
        return `${d}L${fin.x},${fin.y}`;
    }

    // Configuration spécifique au graphe circulaire.
    const configurationGrapheCirculaire = {
        svgSelector: "#activity-svg",

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

        drawLink: (groupeLiens, noeudSource, noeudCible, type, noeuds) => {
            const parcours = calculerParcours(noeudSource, noeudCible, noeuds || []);
            const chemin = cheminAdouci(parcours, CONGE);
            if (!chemin) return d3.select(null);

            // La balle traçante suit le parcours puis se retire d'elle-même. On l'injecte dans le
            // groupe des liens pour qu'elle hérite des transformations de zoom et de panoramique.
            const tir = window.Tracer.tirerSurChemin(groupeLiens.node(), chemin, type);

            // `common-graph.js` attend une sélection D3 ; une sélection vide absorbe sans effet
            // les appels lorsqu'aucun élément n'a pu être créé.
            return tir ? d3.select(tir) : d3.select(null);
        },

        tickHandler: (groupeNoeuds) => {
            groupeNoeuds.selectAll('.node')
                .attr("transform", d => `translate(${d.x || 0},${d.y || 0})`);
            // Les balles traçantes ne sont pas recalculées à chaque battement : elles vivent moins
            // d'une seconde, pendant laquelle les nœuds — épinglés par `positionNodes` — ne
            // bougent pas.
        }
    };

    // Crée le graphe à partir de sa configuration.
    createGraph(configurationGrapheCirculaire);
});
