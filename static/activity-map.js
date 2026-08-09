document.addEventListener("DOMContentLoaded", () => {
    const {trackConnection, fetchJson, setConnectionState} = window.DashboardUtils;

    const svg = document.getElementById('map-svg');

    // Budget de nœuds par colonne. La carte ajoutait auparavant un <div> pour chaque nom distinct
    // jamais rencontré, sans jamais en retirer : sur un broker de longue durée avec des noms de
    // producteurs tournants, le DOM grossissait sans limite et poussait tout hors de l'écran.
    // Les colonnes sont désormais plafonnées et défilent.
    const MAX_NOEUDS_PAR_COLONNE = 60;

    // Plafond de flèches animées simultanément. Chaque flèche est un élément SVG d'une durée de
    // vie d'une seconde ; à quelques milliers de messages par seconde, le navigateur passe son
    // temps à les créer et les détruire.
    const MAX_FLECHES_VIVANTES = 120;

    const colonnes = {
        producer: {el: document.getElementById('producers-col'), noeuds: new Map()},
        topic: {el: document.getElementById('topics-col'), noeuds: new Map()},
        consumer: {el: document.getElementById('consumers-col'), noeuds: new Map()}
    };

    let flechesVivantes = 0;

    // --- Textes d'attente --------------------------------------------------------------------
    function synchroniserTexteAttente(type) {
        const colonne = colonnes[type];
        const existant = colonne.el.querySelector('.placeholder-text');
        if (colonne.noeuds.size === 0) {
            if (!existant) {
                const attente = document.createElement('div');
                attente.className = 'placeholder-text';
                attente.textContent = 'En attente...';
                colonne.el.appendChild(attente);
            }
        } else if (existant) {
            existant.remove();
        }
    }

    // --- Nœuds -------------------------------------------------------------------------------
    /**
     * Garantit qu'un nœud existe dans sa colonne et renvoie son élément.
     * Les nœuds sont indexés dans une Map (et non retrouvés par identifiant DOM) : les noms
     * contenant des caractères délicats pour un sélecteur sont ainsi gérés, et l'éviction est
     * en O(1).
     */
    function toucherNoeud(nom, type) {
        if (typeof nom !== 'string' || nom === '') return null;
        const colonne = colonnes[type];
        if (!colonne) return null;

        let el = colonne.noeuds.get(nom);
        if (el) {
            // Réinsertion pour déplacer l'entrée à l'extrémité « la plus récemment utilisée ».
            colonne.noeuds.delete(nom);
            colonne.noeuds.set(nom, el);
            return el;
        }

        el = document.createElement('div');
        el.className = 'node';
        el.textContent = nom;
        el.title = nom;
        colonne.el.appendChild(el);
        colonne.noeuds.set(nom, el);

        // Évince le nœud le moins récemment actif dès que la colonne est pleine.
        while (colonne.noeuds.size > MAX_NOEUDS_PAR_COLONNE) {
            const cleLaPlusAncienne = colonne.noeuds.keys().next().value;
            const ancien = colonne.noeuds.get(cleLaPlusAncienne);
            colonne.noeuds.delete(cleLaPlusAncienne);
            if (ancien) ancien.remove();
        }

        synchroniserTexteAttente(type);
        return el;
    }

    function retirerNoeud(nom, type) {
        const colonne = colonnes[type];
        if (!colonne) return;
        const el = colonne.noeuds.get(nom);
        if (!el) return;
        colonne.noeuds.delete(nom);
        el.remove();
        synchroniserTexteAttente(type);
    }

    function pulser(el) {
        if (!el) return;
        el.classList.remove('active');
        // Force un recalcul de mise en page pour que l'animation reparte quand le même nœud est
        // sollicité deux fois de suite.
        void el.offsetWidth;
        el.classList.add('active');
    }

    // --- Flèches -----------------------------------------------------------------------------
    function dessinerFleche(elDepart, elArrivee, typeFleche) {
        if (!elDepart || !elArrivee) return;
        if (flechesVivantes >= MAX_FLECHES_VIVANTES) return;

        const rectCarte = svg.getBoundingClientRect();
        const rectDepart = elDepart.getBoundingClientRect();
        const rectArrivee = elArrivee.getBoundingClientRect();

        // On ignore les flèches dont les extrémités ont défilé hors de la zone visible : les
        // tracer produit des traits parasites collés aux bords du conteneur.
        if (rectDepart.bottom < rectCarte.top || rectDepart.top > rectCarte.bottom) return;
        if (rectArrivee.bottom < rectCarte.top || rectArrivee.top > rectCarte.bottom) return;

        flechesVivantes++;
        // La balle traçante gère son propre cycle de vie : elle s'anime, marque l'impact, puis se
        // retire d'elle-même. Plus de pointe de flèche : c'est la tête lumineuse en mouvement qui
        // porte la direction, et elle la porte mieux qu'un triangle statique.
        const tir = window.Tracer.tirer(svg, {
            x1: rectDepart.right - rectCarte.left,
            y1: rectDepart.top + rectDepart.height / 2 - rectCarte.top,
            x2: rectArrivee.left - rectCarte.left,
            y2: rectArrivee.top + rectArrivee.height / 2 - rectCarte.top
        }, typeFleche, {onFin: () => { flechesVivantes--; }});

        // Trajet de longueur nulle : rien n'a été créé, il faut rendre le jeton immédiatement.
        if (!tir) flechesVivantes--;
    }

    // --- État initial ------------------------------------------------------------------------
    async function initialiserCarte() {
        try {
            const etat = await fetchJson('/graph/state');
            // Défensif : une réponse partielle ou en erreur ne doit pas mettre la page à terre.
            (etat.producers || []).forEach(p => toucherNoeud(p, 'producer'));
            (etat.topics || []).forEach(t => toucherNoeud(t, 'topic'));
            (etat.consumers || []).forEach(c => toucherNoeud(c, 'consumer'));
        } catch (erreur) {
            console.error("Échec de l'initialisation de la carte d'activité :", erreur);
            setConnectionState('disconnected', 'état indisponible');
        }
    }

    // --- Branchements ------------------------------------------------------------------------
    for (const type of Object.keys(colonnes)) synchroniserTexteAttente(type);

    const socket = trackConnection(io(), 'activité');

    socket.on('connect', () => {
        // Resynchronisation à chaque (re)connexion : tout ce qui s'est produit pendant la coupure
        // a été manqué.
        initialiserCarte();
    });

    socket.on('new_message', (donnees) => {
        const producteur = toucherNoeud(donnees.producer, 'producer');
        const topic = toucherNoeud(donnees.topic, 'topic');
        pulser(topic);
        dessinerFleche(producteur, topic, 'publish');
    });

    socket.on('new_consumption', (donnees) => {
        const topic = toucherNoeud(donnees.topic, 'topic');
        const consommateur = toucherNoeud(donnees.consumer, 'consumer');
        pulser(consommateur);
        dessinerFleche(topic, consommateur, 'consume');
    });

    socket.on('consumed', (donnees) => {
        const topic = toucherNoeud(donnees.topic, 'topic');
        const consommateur = toucherNoeud(donnees.consumer, 'consumer');
        pulser(consommateur);
        dessinerFleche(topic, consommateur, 'consumed');
    });

    socket.on('new_client', (donnees) => {
        toucherNoeud(donnees.consumer, 'consumer');
        toucherNoeud(donnees.topic, 'topic');
    });

    // Retire les consommateurs qui s'en vont, pour que la carte reflète qui est réellement
    // connecté.
    socket.on('client_disconnected', (donnees) => {
        retirerNoeud(donnees.consumer, 'consumer');
    });
});
