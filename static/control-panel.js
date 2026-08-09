document.addEventListener("DOMContentLoaded", () => {
    const {
        formatTimestamp, formatPayload, renderRows, renderNotice,
        coalesce, trackConnection, fetchJson
    } = window.DashboardUtils;

    // Generate a UUID v4 for message IDs.
    // crypto.randomUUID is available on every browser that supports the rest of this page; the
    // Math.random fallback exists only for non-secure-context origins (plain http on a LAN IP),
    // where crypto.randomUUID is not exposed.
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

    // Base message class for structuring messages.
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

    // Specific business class for text messages.
    class TextMessage extends BaseMessage {
        constructor(text, producer, message_id) {
            super(producer, {text: text}, message_id);
        }
    }

    // --- Table definitions -------------------------------------------------------------------
    // One entry per tab. `cells` are plain accessors; DashboardUtils.renderRows writes them with
    // textContent, so nothing here can inject markup.
    const TABLES = {
        clients: {
            target: '#clients',
            tbody: document.querySelector('#clientsTable tbody'),
            url: '/clients',
            empty: 'Aucun client connecté',
            cells: [
                c => c.consumer,
                c => c.topic,
                c => formatTimestamp(c.connected_at)
            ]
        },
        messages: {
            target: '#messages',
            tbody: document.querySelector('#messagesTable tbody'),
            url: '/messages',
            empty: 'Aucun message publié',
            cells: [
                m => m.producer,
                m => m.topic,
                m => m.message_id,
                m => formatPayload(m.message),
                m => formatTimestamp(m.timestamp)
            ]
        },
        consumptions: {
            target: '#consumptions',
            tbody: document.querySelector('#consTable tbody'),
            url: '/consumptions',
            empty: 'Aucune consommation enregistrée',
            cells: [
                c => c.consumer,
                c => c.topic,
                c => c.message_id,
                c => formatPayload(c.message),
                c => formatTimestamp(c.timestamp)
            ]
        }
    };

    // The tab that is currently visible. Only that table is fetched on an incoming event; the
    // others are marked stale and refreshed when the user switches to them. Previously all three
    // tables were re-fetched on every single event, including the two nobody was looking at.
    let activeTable = 'clients';
    const stale = new Set();

    async function load(key) {
        const table = TABLES[key];
        if (!table || !table.tbody) return;
        try {
            const rows = await fetchJson(table.url);
            // Only clear the body once the data has arrived. The old code emptied it first, which
            // made every refresh flash "En attente..." even though data was already on screen.
            renderRows(table.tbody, rows, table.cells, table.empty);
            stale.delete(key);
        } catch (error) {
            console.error(`Error fetching ${table.url}:`, error);
            renderNotice(table.tbody, table.cells.length, 'Erreur de chargement', 'text-danger');
        }
    }

    // One coalescing refresher per table: an event burst collapses into a single fetch.
    const refresh = {};
    for (const key of Object.keys(TABLES)) {
        refresh[key] = coalesce(() => load(key), 250);
    }

    function invalidate(key) {
        if (key === activeTable) {
            refresh[key]();
        } else {
            stale.add(key);
        }
    }

    // --- Live event stream -------------------------------------------------------------------
    // This socket exists purely to observe the broker. It is created once, on page load, so the
    // tables are populated and stay live even if the user never touches "Connect & Subscribe".
    // Previously every socket handler lived inside the Connect click handler, so a freshly opened
    // Control Panel showed three empty tables until you clicked the button.
    const monitorSocket = trackConnection(io(), 'monitor');

    monitorSocket.on('connect', () => {
        // Refresh on (re)connect: events that fired while we were disconnected were missed.
        for (const key of Object.keys(TABLES)) {
            if (key === activeTable) refresh[key].now();
            else stale.add(key);
        }
    });

    monitorSocket.on('new_message', () => invalidate('messages'));
    monitorSocket.on('new_client', () => invalidate('clients'));
    monitorSocket.on('client_disconnected', () => invalidate('clients'));
    monitorSocket.on('new_consumption', () => invalidate('consumptions'));
    monitorSocket.on('consumed', () => invalidate('consumptions'));

    // --- Test consumer -----------------------------------------------------------------------
    // A second, independent connection used to exercise the broker from the browser.
    // It must NOT reuse the monitor socket: io() with the same URL returns the cached manager, so
    // repeatedly calling io() stacked a new set of listeners on one socket and every event ended
    // up handled N times. forceNew gives this button its own connection, which we tear down
    // explicitly before opening another.
    let consumerSocket = null;
    const connectBtn = document.getElementById("connectBtn");

    connectBtn.addEventListener("click", () => {
        const consumer = document.getElementById("consumer").value.trim();
        const topics = document.getElementById("topics").value
            .split(",").map(s => s.trim()).filter(s => s);

        if (!consumer || topics.length === 0) {
            alert("Please enter a consumer name and at least one topic.");
            return;
        }

        if (consumerSocket) {
            consumerSocket.removeAllListeners();
            consumerSocket.disconnect();
            consumerSocket = null;
        }

        console.log(`Connecting as ${consumer} to topics: ${topics.join(', ')}`);

        consumerSocket = io({
            forceNew: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000
        });

        consumerSocket.on("connect", () => {
            console.log(`Test consumer connected, subscribing to: ${topics.join(', ')}`);
            consumerSocket.emit("subscribe", {consumer, topics});
        });

        consumerSocket.on("message", (data) => {
            // Received by this browser as a subscriber. The tables are fed by the monitor socket,
            // so there is nothing to render here.
            console.log('Message received:', data);
        });

        consumerSocket.on("disconnect", (reason) => {
            console.log(`Test consumer disconnected: ${reason}`);
        });

        consumerSocket.on("connect_error", (error) => {
            console.error('Test consumer connection error:', error);
        });
    });

    // --- Publishing --------------------------------------------------------------------------
    const pubBtn = document.getElementById("pubBtn");

    pubBtn.addEventListener("click", async () => {
        const topic = document.getElementById("pubTopic").value.trim();
        const messageText = document.getElementById("pubMessage").value;
        const producer = document.getElementById("pubProducer").value.trim() || "frontend_publisher";

        if (!topic || !messageText) {
            alert("Please enter a topic and a message to publish.");
            return;
        }

        const payload = new TextMessage(messageText, producer, uuidv4()).toPayload(topic);

        pubBtn.disabled = true;
        try {
            const response = await fetch("/publish", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                // The server may answer with a JSON body or with nothing at all. Blindly calling
                // response.json() on an empty body throws a SyntaxError, which used to surface to
                // the user as "Unexpected end of JSON input" instead of the actual failure.
                let detail = `HTTP ${response.status}`;
                try {
                    const body = await response.json();
                    if (body && body.message) detail = body.message;
                } catch (_) { /* no JSON body - keep the status line */ }
                throw new Error(detail);
            }

            document.getElementById("pubMessage").value = "";
            // The broadcast event will also trigger a refresh, but firing one here means the row
            // shows up even if this browser is not receiving events for some reason.
            invalidate('messages');
        } catch (error) {
            console.error('Publish error:', error);
            alert(`Failed to publish message: ${error.message}`);
        } finally {
            pubBtn.disabled = false;
        }
    });

    // --- Tabs --------------------------------------------------------------------------------
    document.getElementById('pubSubTabs').addEventListener('shown.bs.tab', (event) => {
        const target = event.target.getAttribute('data-bs-target');
        const entry = Object.entries(TABLES).find(([, table]) => table.target === target);
        if (!entry) return;
        const [key] = entry;
        activeTable = key;
        if (stale.has(key)) refresh[key].now();
    });

    // Initial load: the visible tab immediately, the others marked stale.
    for (const key of Object.keys(TABLES)) {
        if (key === activeTable) refresh[key].now();
        else stale.add(key);
    }
});
