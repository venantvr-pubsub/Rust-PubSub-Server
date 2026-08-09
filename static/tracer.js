/**
 * tracer.js
 * Effet « balle traçante » partagé par la carte d'activité et le graphe circulaire :
 * une tête lumineuse qui file vers la cible, suivie d'une traînée qui s'effile derrière elle,
 * puis un éclat d'impact à l'arrivée.
 *
 * La balle suit un **chemin SVG quelconque**, pas seulement un segment : le graphe circulaire lui
 * fournit un tracé qui contourne les nœuds. L'échantillonnage se fait via `getPointAtLength`, et
 * la traînée est obtenue par des pointillés (`stroke-dasharray`) dont la fenêtre visible suit la
 * tête — technique qui fonctionne sur une courbe là où un dégradé linéaire, forcément rectiligne,
 * décrocherait du tracé.
 *
 * Aucun filtre SVG (`feGaussianBlur` & compagnie) : appliqués à des dizaines d'éléments
 * simultanés, ils écroulent le rendu. Le halo est un dégradé radial partagé, l'effilement de la
 * traînée vient de la superposition de trois épaisseurs.
 */
(function (global) {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';

    // Ces couleurs doivent rester alignées sur la légende (style.css, .legend-line).
    const COULEURS = {
        publish: '#22c55e',
        consume: '#ffab40',
        consumed: '#ef4444'
    };

    // Épaisseurs superposées composant la traînée : la plus large et la plus diffuse porte la
    // lueur, la plus fine et la plus courte fait le cœur brillant juste derrière la tête.
    const COUCHES = [
        {epaisseur: 7, opacite: 0.22, portion: 1.0},
        {epaisseur: 3.2, opacite: 0.5, portion: 0.55},
        {epaisseur: 1.8, opacite: 1.0, portion: 0.22}
    ];

    // L'utilisateur peut avoir demandé à son système de limiter les animations.
    const animationsReduites = global.matchMedia
        ? global.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

    function creer(nom, attributs) {
        const el = document.createElementNS(NS, nom);
        for (const [cle, valeur] of Object.entries(attributs)) {
            el.setAttribute(cle, String(valeur));
        }
        return el;
    }

    /**
     * Installe une fois par <svg> les dégradés radiaux servant de halo. Idempotent.
     */
    function installerDefs(svg) {
        if (!svg || svg.dataset.tracerDefs === 'ok') return;
        svg.dataset.tracerDefs = 'ok';

        const defs = creer('defs', {});
        for (const [type, couleur] of Object.entries(COULEURS)) {
            const halo = creer('radialGradient', {id: `tracer-halo-${type}`});
            halo.appendChild(creer('stop', {offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.95'}));
            halo.appendChild(creer('stop', {offset: '35%', 'stop-color': couleur, 'stop-opacity': '0.75'}));
            halo.appendChild(creer('stop', {offset: '100%', 'stop-color': couleur, 'stop-opacity': '0'}));
            defs.appendChild(halo);
        }
        svg.insertBefore(defs, svg.firstChild);
    }

    /**
     * Tire une balle traçante le long d'un chemin SVG.
     *
     * @param {SVGElement} parent  élément d'accueil (hérite des transformations de zoom du graphe)
     * @param {string} d           attribut `d` du chemin à suivre
     * @param {string} type        'publish' | 'consume' | 'consumed'
     * @param {{duree?:number, onFin?:Function}} options
     * @returns {SVGGElement|null} le groupe créé, programmé pour se retirer tout seul
     */
    function tirerSurChemin(parent, d, type, options = {}) {
        if (!parent || !d) return null;

        const couleur = COULEURS[type] || COULEURS.consumed;
        installerDefs(parent.ownerSVGElement || parent);

        const groupe = creer('g', {class: `tracer tracer-${type}`});
        const couches = COUCHES.map(({epaisseur, opacite}) => creer('path', {
            d,
            fill: 'none',
            stroke: couleur,
            'stroke-width': epaisseur,
            'stroke-linecap': 'round',
            opacity: opacite
        }));

        const halo = creer('circle', {class: 'tracer-halo', r: 9, fill: `url(#tracer-halo-${type})`});
        const coeur = creer('circle', {class: 'tracer-core', r: 2.6, fill: '#ffffff'});

        groupe.append(...couches, halo, coeur);
        parent.appendChild(groupe);

        // `getTotalLength` exige un élément rattaché au document.
        const longueur = couches[0].getTotalLength();
        if (!(longueur > 0)) {
            groupe.remove();
            return null;
        }

        const terminer = () => {
            groupe.remove();
            if (typeof options.onFin === 'function') options.onFin();
        };

        const placerTete = (distance) => {
            const point = couches[0].getPointAtLength(distance);
            halo.setAttribute('cx', point.x);
            halo.setAttribute('cy', point.y);
            coeur.setAttribute('cx', point.x);
            coeur.setAttribute('cy', point.y);
        };

        // Mode « animations réduites » : on montre le trajet complet, sans mouvement.
        if (animationsReduites) {
            placerTete(longueur);
            setTimeout(terminer, 700);
            return groupe;
        }

        // Une balle doit être rapide : vol court, éclat d'impact encore plus bref.
        const dureeVol = options.duree || Math.min(620, Math.max(300, longueur * 1.1));
        const dureeImpact = 200;
        // Longueur de la traînée, proportionnelle au trajet mais bornée pour rester lisible aussi
        // bien sur un lien court que sur la diagonale de l'écran. Volontairement généreuse : la
        // queue est encore près du départ quand la tête touche la cible, ce qui donne au tir sa
        // lisibilité — on voit d'où il vient autant que où il va.
        const trainee = Math.min(460, Math.max(90, longueur * 0.75));

        // Fenêtre visible de chaque couche : un tiret de longueur `portion * trainee` dont la fin
        // colle à la tête. Le trou qui suit est plus long que le chemin entier, si bien qu'aucun
        // second tiret ne peut apparaître.
        couches.forEach((couche, i) => {
            const longueurTiret = trainee * COUCHES[i].portion;
            couche.setAttribute('stroke-dasharray', `${longueurTiret} ${longueur + longueurTiret}`);
        });

        let debut = null;

        function image(maintenant) {
            if (debut === null) debut = maintenant;
            const ecoule = maintenant - debut;

            if (ecoule < dureeVol) {
                const t = ecoule / dureeVol;
                // Légère décélération : la balle « arrive » au lieu de percuter à vitesse constante.
                const avance = longueur * (1 - Math.pow(1 - t, 2));

                couches.forEach((couche, i) => {
                    const longueurTiret = trainee * COUCHES[i].portion;
                    couche.setAttribute('stroke-dashoffset', String(longueurTiret - avance));
                });
                placerTete(avance);

                requestAnimationFrame(image);
                return;
            }

            // Impact : la traînée s'efface pendant que le halo se dilate.
            const t = Math.min((ecoule - dureeVol) / dureeImpact, 1);
            const restant = 1 - t;

            couches.forEach((couche, i) => {
                couche.setAttribute('opacity', String(COUCHES[i].opacite * restant));
            });
            placerTete(longueur);
            halo.setAttribute('r', String(9 + 10 * t));
            halo.setAttribute('opacity', String(restant));
            coeur.setAttribute('opacity', String(restant));

            if (t < 1) {
                requestAnimationFrame(image);
            } else {
                terminer();
            }
        }

        requestAnimationFrame(image);
        return groupe;
    }

    /** Raccourci pour un tir en ligne droite. */
    function tirer(parent, {x1, y1, x2, y2}, type, options) {
        if (!(Math.hypot(x2 - x1, y2 - y1) > 0)) return null;
        return tirerSurChemin(parent, `M${x1},${y1}L${x2},${y2}`, type, options);
    }

    global.Tracer = {COULEURS, installerDefs, tirer, tirerSurChemin};
})(window);
