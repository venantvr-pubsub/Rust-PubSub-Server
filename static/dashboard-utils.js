/**
 * dashboard-utils.js
 * Petits utilitaires partagés par les pages du dashboard : rendu sûr des tableaux, regroupement
 * des rafraîchissements, formatage des horodatages et indicateur de connexion de la barre de
 * navigation.
 */
(function (global) {
    'use strict';

    /**
     * Formate un horodatage Unix exprimé en secondes (éventuellement fractionnaires).
     * Le serveur envoie des f64 en secondes ; `Date` attend des millisecondes.
     */
    function formatTimestamp(secondesUnix) {
        if (typeof secondesUnix !== 'number' || !isFinite(secondesUnix)) return '';
        return new Date(secondesUnix * 1000).toLocaleString();
    }

    /**
     * Prépare une charge utile pour l'affichage, sans jamais l'interpréter comme du balisage.
     * Les charges trop longues sont tronquées : un seul message volumineux ne doit pas faire
     * exploser la mise en page du tableau.
     */
    function formatPayload(valeur, longueurMax = 300) {
        let texte;
        if (typeof valeur === 'string') {
            texte = valeur;
        } else {
            try {
                texte = JSON.stringify(valeur);
            } catch (_) {
                texte = String(valeur);
            }
        }
        if (texte === undefined) texte = '';
        return texte.length > longueurMax ? `${texte.slice(0, longueurMax)}…` : texte;
    }

    /**
     * Remplace le contenu d'un <tbody> par une ligne par élément.
     *
     * Les valeurs des cellules sont écrites via textContent, jamais via innerHTML : les charges
     * utiles, les noms de topics et les noms de consommateurs sont contrôlés par l'extérieur
     * (quiconque peut publier choisit ces valeurs). Les interpoler dans innerHTML constituait donc
     * une faille XSS stockée.
     *
     * @param {HTMLElement} tbody        corps de tableau ciblé
     * @param {Array} elements           lignes à afficher
     * @param {Array<Function>} cellules un accesseur par colonne, renvoyant le texte de la cellule
     * @param {string} messageVide       affiché lorsque `elements` est vide
     */
    function renderRows(tbody, elements, cellules, messageVide) {
        if (!tbody) return;
        const fragment = document.createDocumentFragment();

        if (!elements || elements.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = cellules.length;
            td.className = 'text-center text-muted';
            td.textContent = messageVide;
            tr.appendChild(td);
            fragment.appendChild(tr);
        } else {
            for (const element of elements) {
                const tr = document.createElement('tr');
                for (const cellule of cellules) {
                    const td = document.createElement('td');
                    td.textContent = cellule(element);
                    tr.appendChild(td);
                }
                fragment.appendChild(tr);
            }
        }

        tbody.replaceChildren(fragment);
    }

    /** Affiche une unique ligne d'état occupant toute la largeur (chargement / erreur). */
    function renderNotice(tbody, nombreColonnes, message, variante = 'text-muted') {
        if (!tbody) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = nombreColonnes;
        td.className = `text-center ${variante}`;
        td.textContent = message;
        tr.replaceChildren(td);
        tbody.replaceChildren(tr);
    }

    /**
     * Enveloppe une fonction asynchrone de sorte que :
     *  - les rafales d'appels se réduisent à une seule exécution (front descendant, `attente` ms) ;
     *  - une seule exécution soit en vol à la fois ;
     *  - un appel arrivant pendant une exécution planifie exactement une exécution de rattrapage.
     *
     * Le dashboard se rafraîchit à chaque événement `new_message`. Sans cela, un producteur à
     * 1 000 msg/s déclenchait 1 000 rechargements complets de tableau par seconde et le navigateur
     * passait son temps à réafficher des instantanés déjà périmés.
     */
    function coalesce(fn, attente = 250) {
        let minuteur = null;
        let enCours = false;
        let enAttente = false;

        async function executer() {
            if (enCours) {
                enAttente = true;
                return;
            }
            enCours = true;
            try {
                await fn();
            } catch (erreur) {
                console.error('Échec du rafraîchissement :', erreur);
            } finally {
                enCours = false;
                if (enAttente) {
                    enAttente = false;
                    planifier();
                }
            }
        }

        function planifier() {
            if (minuteur !== null) return;
            minuteur = setTimeout(() => {
                minuteur = null;
                executer();
            }, attente);
        }

        planifier.now = executer;
        planifier.cancel = () => {
            if (minuteur !== null) {
                clearTimeout(minuteur);
                minuteur = null;
            }
        };
        return planifier;
    }

    /**
     * Pilote la pastille de connexion produite par nav.js.
     * @param {'connected'|'connecting'|'disconnected'} etat
     */
    function setConnectionState(etat, detail) {
        const pastille = document.getElementById('connectionStatus');
        if (!pastille) return;
        const libelles = {
            connected: 'Connecté',
            connecting: 'Connexion…',
            disconnected: 'Déconnecté'
        };
        pastille.dataset.state = etat;
        pastille.textContent = detail ? `${libelles[etat]} · ${detail}` : (libelles[etat] || etat);
    }

    /**
     * Attache les gestionnaires standards du cycle de vie d'une connexion à un socket Socket.IO.
     * Renvoie le socket pour permettre le chaînage.
     */
    function trackConnection(socket, libelle) {
        setConnectionState('connecting');
        socket.on('connect', () => setConnectionState('connected', libelle));
        socket.on('disconnect', () => setConnectionState('disconnected'));
        socket.on('connect_error', () => setConnectionState('disconnected'));
        return socket;
    }

    /** fetch() + JSON avec contrôle explicite du statut, pour qu'une 4xx/5xx ne soit pas décodée
     *  comme si c'étaient des données valides. */
    async function fetchJson(url) {
        const reponse = await fetch(url);
        if (!reponse.ok) {
            throw new Error(`${url} a répondu ${reponse.status}`);
        }
        return reponse.json();
    }

    global.DashboardUtils = {
        formatTimestamp,
        formatPayload,
        renderRows,
        renderNotice,
        coalesce,
        setConnectionState,
        trackConnection,
        fetchJson
    };
})(window);
