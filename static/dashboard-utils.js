/**
 * dashboard-utils.js
 * Small helpers shared by the dashboard pages: safe table rendering, refresh coalescing,
 * timestamp formatting and the navbar connection indicator.
 */
(function (global) {
    'use strict';

    /**
     * Format a Unix timestamp expressed in (fractional) seconds.
     * The server sends f64 seconds; Date expects milliseconds.
     */
    function formatTimestamp(unixSeconds) {
        if (typeof unixSeconds !== 'number' || !isFinite(unixSeconds)) return '';
        return new Date(unixSeconds * 1000).toLocaleString();
    }

    /**
     * Render a message payload for display without ever interpreting it as markup.
     * Long payloads are truncated so a single fat message cannot blow up the table layout.
     */
    function formatPayload(value, maxLength = 300) {
        let text;
        if (typeof value === 'string') {
            text = value;
        } else {
            try {
                text = JSON.stringify(value);
            } catch (_) {
                text = String(value);
            }
        }
        if (text === undefined) text = '';
        return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
    }

    /**
     * Replace the contents of a <tbody> with one row per item.
     *
     * Cell values are written with textContent, never innerHTML: message payloads, topic names and
     * consumer names are attacker-controlled (anyone who can publish can choose them), so string
     * interpolation into innerHTML here is a stored-XSS sink.
     *
     * @param {HTMLElement} tbody      target table body
     * @param {Array} items            rows to display
     * @param {Array<Function>} cells  one accessor per column, returning the cell text
     * @param {string} emptyMessage    shown when `items` is empty
     */
    function renderRows(tbody, items, cells, emptyMessage) {
        if (!tbody) return;
        const fragment = document.createDocumentFragment();

        if (!items || items.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = cells.length;
            td.className = 'text-center text-muted';
            td.textContent = emptyMessage;
            tr.appendChild(td);
            fragment.appendChild(tr);
        } else {
            for (const item of items) {
                const tr = document.createElement('tr');
                for (const cell of cells) {
                    const td = document.createElement('td');
                    td.textContent = cell(item);
                    tr.appendChild(td);
                }
                fragment.appendChild(tr);
            }
        }

        tbody.replaceChildren(fragment);
    }

    /** Render a single full-width status row (loading / error). */
    function renderNotice(tbody, columnCount, message, variant = 'text-muted') {
        if (!tbody) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columnCount;
        td.className = `text-center ${variant}`;
        td.textContent = message;
        tr.replaceChildren(td);
        tbody.replaceChildren(tr);
    }

    /**
     * Wrap an async function so that:
     *  - bursts of calls collapse into a single run (trailing edge, `wait` ms);
     *  - only one run is ever in flight;
     *  - a call arriving during a run schedules exactly one follow-up run.
     *
     * The dashboard refreshes on every `new_message` event. Without this, a producer doing 1k
     * msg/s triggers 1k full table fetches per second and the browser spends all its time
     * re-rendering stale snapshots.
     */
    function coalesce(fn, wait = 250) {
        let timer = null;
        let running = false;
        let pending = false;

        async function run() {
            if (running) {
                pending = true;
                return;
            }
            running = true;
            try {
                await fn();
            } catch (error) {
                console.error('Refresh failed:', error);
            } finally {
                running = false;
                if (pending) {
                    pending = false;
                    schedule();
                }
            }
        }

        function schedule() {
            if (timer !== null) return;
            timer = setTimeout(() => {
                timer = null;
                run();
            }, wait);
        }

        schedule.now = run;
        schedule.cancel = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };
        return schedule;
    }

    /**
     * Drive the connection pill rendered by nav.js.
     * @param {'connected'|'connecting'|'disconnected'} state
     */
    function setConnectionState(state, detail) {
        const badge = document.getElementById('connectionStatus');
        if (!badge) return;
        const labels = {
            connected: 'Connecté',
            connecting: 'Connexion…',
            disconnected: 'Déconnecté'
        };
        badge.dataset.state = state;
        badge.textContent = detail ? `${labels[state]} · ${detail}` : (labels[state] || state);
    }

    /**
     * Attach the standard connection lifecycle handlers to a socket.io socket.
     * Returns the socket so it can be chained.
     */
    function trackConnection(socket, label) {
        setConnectionState('connecting');
        socket.on('connect', () => setConnectionState('connected', label));
        socket.on('disconnect', () => setConnectionState('disconnected'));
        socket.on('connect_error', () => setConnectionState('disconnected'));
        return socket;
    }

    /** fetch() + JSON with an explicit status check, so a 4xx/5xx does not decode as data. */
    async function fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`${url} responded ${response.status}`);
        }
        return response.json();
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
