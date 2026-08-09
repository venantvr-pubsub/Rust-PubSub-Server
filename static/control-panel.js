document.addEventListener("DOMContentLoaded", () => {
    const {
        formatTimestamp, formatPayload, renderRows, renderNotice,
        coalesce, trackConnection, fetchJson
    } = window.DashboardUtils;

    // Génère un UUID v4 pour les identifiants de message.
    // `crypto.randomUUID` est disponible sur tous les navigateurs capables d'afficher le reste de
    // cette page ; le repli sur Math.random n'existe que pour les origines hors contexte sécurisé
    // (http simple sur une IP de réseau local), où `crypto.randomUUID` n'est pas exposé.
    function uuidv4() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Classe de base pour structurer les messages.
    class BaseMessage {
        constructor(producer, payload, message_id = null) {
            this.message_id = message_id || uuidv4();
            this.producer = producer;
            this.payload = payload;
        }

        toPayload(topic) {
            return {
                topic: topic,
                message_id: this.message_id,
                message: this.payload,
                producer: this.producer
            };
        }
    }

    // Classe métier spécifique aux messages texte.
    class TextMessage extends BaseMessage {
        constructor(text, producer, message_id) {
            super(producer, {text: text}, message_id);
        }
    }

    // --- Définition des tableaux -------------------------------------------------------------
    // Une entrée par onglet. Les `cellules` sont de simples accesseurs ; renderRows les écrit via
    // textContent, donc rien ici ne peut injecter de balisage.
    const TABLEAUX = {
        clients: {
            cible: '#clients',
            tbody: document.querySelector('#clientsTable tbody'),
            url: '/clients',
            vide: 'Aucun client connecté',
            cellules: [
                c => c.consumer,
                c => c.topic,
                c => formatTimestamp(c.connected_at)
            ]
        },
        messages: {
            cible: '#messages',
            tbody: document.querySelector('#messagesTable tbody'),
            url: '/messages',
            vide: 'Aucun message publié',
            cellules: [
                m => m.producer,
                m => m.topic,
                m => m.message_id,
                m => formatPayload(m.message),
                m => formatTimestamp(m.timestamp)
            ]
        },
        consumptions: {
            cible: '#consumptions',
            tbody: document.querySelector('#consTable tbody'),
            url: '/consumptions',
            vide: 'Aucune consommation enregistrée',
            cellules: [
                c => c.consumer,
                c => c.topic,
                c => c.message_id,
                c => formatPayload(c.message),
                c => formatTimestamp(c.timestamp)
            ]
        }
    };

    // Onglet actuellement visible. Seul ce tableau est rechargé lorsqu'un événement arrive ; les
    // autres sont marqués périmés et rechargés au changement d'onglet. Auparavant, les trois
    // tableaux étaient rechargés à chaque événement, y compris les deux que personne ne regardait.
    let tableauActif = 'clients';
    const perimes = new Set();

    async function charger(cle) {
        const tableau = TABLEAUX[cle];
        if (!tableau || !tableau.tbody) return;
        try {
            const lignes = await fetchJson(tableau.url);
            // On ne vide le corps du tableau qu'une fois les données arrivées. L'ancien code le
            // vidait d'abord, ce qui faisait clignoter « En attente... » à chaque rafraîchissement
            // alors que des données étaient déjà affichées.
            renderRows(tableau.tbody, lignes, tableau.cellules, tableau.vide);
            perimes.delete(cle);
        } catch (erreur) {
            console.error(`Erreur lors de la récupération de ${tableau.url} :`, erreur);
            renderNotice(tableau.tbody, tableau.cellules.length, 'Erreur de chargement', 'text-danger');
        }
    }

    // Un regroupeur par tableau : une rafale d'événements se réduit à un seul chargement.
    const rafraichir = {};
    for (const cle of Object.keys(TABLEAUX)) {
        rafraichir[cle] = coalesce(() => charger(cle), 250);
    }

    function invalider(cle) {
        if (cle === tableauActif) {
            rafraichir[cle]();
        } else {
            perimes.add(cle);
        }
    }

    // --- Flux d'événements temps réel --------------------------------------------------------
    // Ce socket sert uniquement à observer le broker. Il est créé une seule fois, au chargement de
    // la page, afin que les tableaux soient remplis et restent à jour même si l'utilisateur ne
    // touche jamais au bouton « Connect & Subscribe ». Auparavant, tous les gestionnaires vivaient
    // à l'intérieur du gestionnaire de clic de ce bouton : un Control Panel fraîchement ouvert
    // affichait donc trois tableaux vides tant qu'on n'avait pas cliqué.
    const socketMoniteur = trackConnection(io(), 'moniteur');

    socketMoniteur.on('connect', () => {
        // Rechargement à la (re)connexion : les événements survenus pendant la coupure sont perdus.
        for (const cle of Object.keys(TABLEAUX)) {
            if (cle === tableauActif) rafraichir[cle].now();
            else perimes.add(cle);
        }
    });

    socketMoniteur.on('new_message', () => invalider('messages'));
    socketMoniteur.on('new_client', () => invalider('clients'));
    socketMoniteur.on('client_disconnected', () => invalider('clients'));
    socketMoniteur.on('new_consumption', () => invalider('consumptions'));
    socketMoniteur.on('consumed', () => invalider('consumptions'));

    // --- Consommateur de test ----------------------------------------------------------------
    // Une seconde connexion, indépendante, pour éprouver le broker depuis le navigateur.
    // Elle ne doit PAS réutiliser le socket du moniteur : `io()` avec la même URL renvoie le
    // gestionnaire mis en cache, si bien qu'appeler `io()` à répétition empilait un nouveau jeu de
    // gestionnaires sur un seul et même socket et que chaque événement finissait traité N fois.
    // `forceNew` donne à ce bouton sa propre connexion, que l'on démonte explicitement avant d'en
    // ouvrir une autre.
    let socketConsommateur = null;
    const boutonConnexion = document.getElementById("connectBtn");

    boutonConnexion.addEventListener("click", () => {
        const consumer = document.getElementById("consumer").value.trim();
        const topics = document.getElementById("topics").value
            .split(",").map(s => s.trim()).filter(s => s);

        if (!consumer || topics.length === 0) {
            alert("Veuillez saisir un nom de consommateur et au moins un topic.");
            return;
        }

        if (socketConsommateur) {
            socketConsommateur.removeAllListeners();
            socketConsommateur.disconnect();
            socketConsommateur = null;
        }

        console.log(`Connexion en tant que ${consumer} aux topics : ${topics.join(', ')}`);

        socketConsommateur = io({
            forceNew: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000
        });

        socketConsommateur.on("connect", () => {
            console.log(`Consommateur de test connecté, abonnement à : ${topics.join(', ')}`);
            socketConsommateur.emit("subscribe", {consumer, topics});
        });

        socketConsommateur.on("message", (donnees) => {
            // Reçu par ce navigateur en tant qu'abonné. Les tableaux sont alimentés par le socket
            // moniteur : il n'y a donc rien à afficher ici.
            console.log('Message reçu :', donnees);
        });

        socketConsommateur.on("disconnect", (raison) => {
            console.log(`Consommateur de test déconnecté : ${raison}`);
        });

        socketConsommateur.on("connect_error", (erreur) => {
            console.error('Erreur de connexion du consommateur de test :', erreur);
        });
    });

    // --- Publication -------------------------------------------------------------------------
    const boutonPublier = document.getElementById("pubBtn");

    boutonPublier.addEventListener("click", async () => {
        const topic = document.getElementById("pubTopic").value.trim();
        const texteMessage = document.getElementById("pubMessage").value;
        const producer = document.getElementById("pubProducer").value.trim() || "frontend_publisher";

        if (!topic || !texteMessage) {
            alert("Veuillez saisir un topic et un message à publier.");
            return;
        }

        const payload = new TextMessage(texteMessage, producer, uuidv4()).toPayload(topic);

        boutonPublier.disabled = true;
        try {
            const reponse = await fetch("/publish", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload)
            });

            if (!reponse.ok) {
                // Le serveur peut répondre avec un corps JSON, ou sans corps du tout. Appeler
                // aveuglément `response.json()` sur un corps vide lève une SyntaxError, qui
                // remontait à l'utilisateur sous la forme « Unexpected end of JSON input » au lieu
                // de la véritable cause de l'échec.
                let detail = `HTTP ${reponse.status}`;
                try {
                    const corps = await reponse.json();
                    if (corps && corps.message) detail = corps.message;
                } catch (_) { /* pas de corps JSON — on garde la ligne de statut */ }
                throw new Error(detail);
            }

            document.getElementById("pubMessage").value = "";
            // L'événement de diffusion provoquera aussi un rafraîchissement, mais en déclencher un
            // ici garantit que la ligne apparaît même si ce navigateur ne reçoit pas les
            // événements pour une raison quelconque.
            invalider('messages');
        } catch (erreur) {
            console.error('Erreur de publication :', erreur);
            alert(`Échec de la publication du message : ${erreur.message}`);
        } finally {
            boutonPublier.disabled = false;
        }
    });

    // --- Onglets -----------------------------------------------------------------------------
    document.getElementById('pubSubTabs').addEventListener('shown.bs.tab', (evenement) => {
        const cible = evenement.target.getAttribute('data-bs-target');
        const entree = Object.entries(TABLEAUX).find(([, tableau]) => tableau.cible === cible);
        if (!entree) return;
        const [cle] = entree;
        tableauActif = cle;
        if (perimes.has(cle)) rafraichir[cle].now();
    });

    // Chargement initial : l'onglet visible immédiatement, les autres marqués périmés.
    for (const cle of Object.keys(TABLEAUX)) {
        if (cle === tableauActif) rafraichir[cle].now();
        else perimes.add(cle);
    }
});
