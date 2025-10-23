document.addEventListener("DOMContentLoaded", () => {
    const MAX_LIST_SIZE = 100; // Limite globale pour toutes les listes

    // Generate a UUID v4 for message IDs
    function uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = Math.random() * 16 | 0,
                v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Base message class for structuring messages
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

    // Specific business class for text messages
    class TextMessage extends BaseMessage {
        constructor(text, producer, message_id) {
            super(producer, {text: text}, message_id);
        }
    }

    let socket;

    // Handle connect and subscribe button click
    document.getElementById("connectBtn").addEventListener("click", () => {
        const consumer = document.getElementById("consumer").value;
        const topics = document.getElementById("topics").value
            .split(",").map(s => s.trim()).filter(s => s);

        if (!consumer || topics.length === 0) {
            alert("Please enter a consumer name and at least one topic.");
            return;
        }

        console.log(`Connecting as ${consumer} to topics: ${topics}`);

        // If a socket already exists and is connected, disconnect first
        if (socket && socket.connected) {
            console.log("Disconnecting existing socket before new connection.");
            socket.disconnect();
        }

        socket = io({
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000
        });

        socket.on("connect", () => {
            console.log("Connected to server.");
            socket.emit("subscribe", {consumer, topics});
            console.log(`Subscribed to topics: ${topics}`);
            // Refresh admin tables on successful connection
            refreshMessages();
            refreshClients();
            refreshConsumptions();
        });

        socket.on("message", (data) => {
            console.log(`Message received: ${JSON.stringify(data)}`);
            // Message received - no UI display needed (removed Received Messages tab)
        });

        socket.on("disconnect", () => console.log("Disconnected from server."));
        socket.on("new_message", () => refreshMessages());
        socket.on("new_client", () => refreshClients());
        socket.on("client_disconnected", () => refreshClients());
        socket.on("new_consumption", () => refreshConsumptions());
        socket.on("consumed", (data) => {
            console.log(`Consumed by handler: ${data.consumer} - Topic: ${data.topic} - Message ID: ${data.message_id}`);
            refreshConsumptions();
        });
    });

    document.getElementById("pubBtn").addEventListener("click", () => {
        const topic = document.getElementById("pubTopic").value;
        const messageText = document.getElementById("pubMessage").value;
        const producer = document.getElementById("pubProducer").value || "frontend_publisher";

        if (!topic || !messageText) {
            alert("Please enter a topic and a message to publish.");
            return;
        }

        const msg = new TextMessage(messageText, producer, uuidv4());
        const payload = msg.toPayload(topic);

        fetch("/publish", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        })
            .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.message))))
            .then(data => {
                console.log(`Publish response: ${JSON.stringify(data)}`);
                document.getElementById("pubMessage").value = "";
            })
            .catch(err => {
                console.error(`Publish error: ${err}`);
                alert(`Failed to publish message: ${err.message}`);
            });
    });

    // Helper function to format timestamp
    function formatTimestamp(unixTimestamp) {
        if (!unixTimestamp) return '';
        return new Date(unixTimestamp * 1000).toLocaleString();
    }

    // Refresh the clients table
    function refreshClients() {
        console.log("Refreshing clients list");
        const tbody = document.querySelector("#clientsTable tbody");
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">En attente...</td></tr>';

        fetch("/clients")
            .then(r => r.json())
            .then(clients => {
                tbody.innerHTML = "";
                if (clients.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Aucun client connecté</td></tr>';
                } else {
                    // --- ADDITION: Limit number of displayed clients ---
                    clients.slice(0, MAX_LIST_SIZE).forEach(c => {
                        const tr = document.createElement("tr");
                        tr.innerHTML = `<td>${c.consumer}</td><td>${c.topic}</td><td>${formatTimestamp(c.connected_at)}</td>`;
                        tbody.appendChild(tr);
                    });
                }
            })
            .catch(err => {
                console.error(`Error fetching clients: ${err}`);
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Erreur de chargement</td></tr>';
            });
    }

    // Refresh the messages table
    function refreshMessages() {
        console.log("Refreshing published messages list");
        const tbody = document.querySelector("#messagesTable tbody");
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">En attente...</td></tr>';

        fetch("/messages")
            .then(r => r.json())
            .then(messages => {
                tbody.innerHTML = "";
                if (messages.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Aucun message publié</td></tr>';
                } else {
                    // --- ADDITION: Limit number of displayed messages ---
                    messages.slice(0, MAX_LIST_SIZE).forEach(m => {
                        const tr = document.createElement("tr");
                        tr.innerHTML = `<td>${m.producer}</td><td>${m.topic}</td><td>${JSON.stringify(m.message)}</td><td>${formatTimestamp(m.timestamp)}</td>`;
                        tbody.appendChild(tr);
                    });
                    console.log(`Published messages list updated with ${messages.length} messages`);
                }
            })
            .catch(err => {
                console.error(`Error fetching messages: ${err}`);
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Erreur de chargement</td></tr>';
            });
    }

    // Refresh the consumptions table
    function refreshConsumptions() {
        console.log("Refreshing consumptions list");
        const tbody = document.querySelector("#consTable tbody");
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">En attente...</td></tr>';

        fetch("/consumptions")
            .then(r => r.json())
            .then(consumptions => {
                tbody.innerHTML = "";
                if (consumptions.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Aucune consommation enregistrée</td></tr>';
                } else {
                    // --- AJOUT : Limiter le nombre de consommations affichées ---
                    consumptions.slice(0, MAX_LIST_SIZE).forEach(c => {
                        const tr = document.createElement("tr");
                        tr.innerHTML = `<td>${c.consumer}</td><td>${c.topic}</td><td>${JSON.stringify(c.message)}</td><td>${formatTimestamp(c.timestamp)}</td>`;
                        tbody.appendChild(tr);
                    });
                    console.log(`Consumptions list updated with ${consumptions.length} consumptions`);
                }
            })
            .catch(err => {
                console.error(`Error fetching consumptions: ${err}`);
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Erreur de chargement</td></tr>';
            });
    }

    // Refresh tab content when switching tabs
    document.getElementById('pubSubTabs').addEventListener('shown.bs.tab', function (event) {
        const targetTab = event.target.getAttribute('data-bs-target');
        if (targetTab === '#clients') refreshClients();
        else if (targetTab === '#messages') refreshMessages();
        else if (targetTab === '#consumptions') refreshConsumptions();
    });
});
