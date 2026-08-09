// Garde du dashboard — intercepte l'accès aux pages et redirige vers la page de connexion
// lorsque le dashboard n'est pas activé.
// Ce script DOIT être inclus en PREMIER sur chaque page du dashboard (y compris login.html, qui ne
// s'en sert que pour les fonctions utilitaires de redirection partagées).
//
// À propos du modèle de menace : le drapeau `dashboardEnabled` dans localStorage est un simple
// confort d'usage, pas une frontière de sécurité. L'état réel vit côté serveur
// (`/dashboard/status`) et il est global au processus. La garde réconcilie les deux pour qu'une
// entrée localStorage périmée (après un redémarrage du serveur, par exemple) ne laisse pas
// l'utilisateur devant un dashboard qui ne recevra jamais le moindre événement.

(function () {
    'use strict';

    // Pages qui exigent que le dashboard soit activé.
    const PAGES_PROTEGEES = [
        '/control-panel.html',
        '/activity-map.html',
        '/circular-graph.html'
    ];

    const PAGE_CONNEXION = '/login.html';
    const PAGE_PAR_DEFAUT = '/control-panel.html';
    const CLE_STOCKAGE = 'dashboardEnabled';

    // localStorage lève une exception dans certaines configurations de navigateur (navigation
    // privée saturée, stockage désactivé). Échouer en mode « fermé » interdirait purement et
    // simplement l'accès au dashboard : on dégrade donc proprement.
    function lireActivation() {
        try {
            return window.localStorage.getItem(CLE_STOCKAGE) === 'true';
        } catch (_) {
            return false;
        }
    }

    function ecrireActivation(valeur) {
        try {
            window.localStorage.setItem(CLE_STOCKAGE, valeur ? 'true' : 'false');
        } catch (_) {
            /* stockage indisponible — le drapeau serveur reste la source de vérité */
        }
    }

    // On ne redirige jamais que vers une page connue du dashboard, sur la même origine.
    // Sans ce contrôle, `/login.html?redirect=https://exemple-malveillant` constitue une
    // redirection ouverte.
    function cibleRedirectionSure(cibleBrute) {
        if (!cibleBrute) return PAGE_PAR_DEFAUT;
        // Une URL absolue ou relative au protocole (« //exemple-malveillant ») ne doit jamais
        // être honorée.
        if (!cibleBrute.startsWith('/') || cibleBrute.startsWith('//')) return PAGE_PAR_DEFAUT;
        return PAGES_PROTEGEES.includes(cibleBrute) ? cibleBrute : PAGE_PAR_DEFAUT;
    }

    const cheminCourant = window.location.pathname;
    const estPageProtegee = PAGES_PROTEGEES.includes(cheminCourant);
    const dashboardActive = lireActivation();

    function redirigerVersConnexion() {
        window.location.replace(`${PAGE_CONNEXION}?redirect=${encodeURIComponent(cheminCourant)}`);
    }

    // `installerDeconnexion` est appelée à la fois par ce script (dès que le DOM est prêt) et par
    // nav.js (une fois le balisage de l'en-tête créé). Celle qui s'exécute après l'apparition du
    // bouton l'emporte ; le drapeau empêche d'attacher deux fois le gestionnaire de clic, ce qui
    // déclencherait deux requêtes de déconnexion par clic.
    let deconnexionInstallee = false;

    function installerDeconnexion() {
        if (deconnexionInstallee) return;
        const bouton = document.getElementById('dashboardLogoutBtn');
        if (!bouton) return;
        deconnexionInstallee = true;

        bouton.addEventListener('click', async () => {
            bouton.disabled = true;
            try {
                await fetch('/dashboard/logout', {method: 'POST'});
            } catch (erreur) {
                console.error('Erreur de déconnexion :', erreur);
            } finally {
                // Quoi qu'ait répondu le serveur, on abandonne le drapeau local et on quitte.
                ecrireActivation(false);
                window.location.href = PAGE_CONNEXION;
            }
        });
    }

    // Réconcilie le drapeau local avec le serveur. Un redémarrage du serveur remet
    // `dashboard_enabled` à false ; sans ce contrôle, la page se chargeait, se connectait, puis ne
    // recevait plus jamais rien, en silence.
    async function verifierAupresDuServeur() {
        try {
            const reponse = await fetch('/dashboard/status');
            if (!reponse.ok) return;
            const donnees = await reponse.json();
            if (donnees.dashboard_enabled === false) {
                ecrireActivation(false);
                redirigerVersConnexion();
            }
        } catch (erreur) {
            // Incident réseau : on garde la page utilisable plutôt que de renvoyer l'utilisateur
            // vers la page de connexion.
            console.warn('Impossible de vérifier l\'état du dashboard :', erreur);
        }
    }

    if (estPageProtegee && !dashboardActive) {
        redirigerVersConnexion();
        // On arrête ce script ici. À noter que les balises <script> suivantes de la page
        // continuent de s'exécuter jusqu'à ce que la navigation soit effective : c'est pourquoi le
        // script propre à chaque page reste lui aussi défensif.
        throw new Error('Redirection vers la page de connexion');
    }

    if (estPageProtegee) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', installerDeconnexion);
        } else {
            installerDeconnexion();
        }
        verifierAupresDuServeur();
    }

    window.dashboardGuard = {
        isAuthenticated: dashboardActive,
        protectedPages: PAGES_PROTEGEES.slice(),
        defaultPage: PAGE_PAR_DEFAUT,
        safeRedirectTarget: cibleRedirectionSure,
        readEnabled: lireActivation,
        writeEnabled: ecrireActivation,
        setupLogout: installerDeconnexion
    };
})();
