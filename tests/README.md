# Tests et Scripts de Performance

Ce dossier contient les scripts Python pour tester et évaluer les performances du serveur PubSub.

## Prérequis

```bash
make install
# ou
pip3 install python-socketio requests
```

## Scripts Disponibles

### 1. Tests de Base

#### `demo_socketio.py`

Client de démonstration Socket.IO interactif.

```bash
make demo
# ou
python3 tests/demo_socketio.py
```

- Connecte au serveur
- Souscrit à un topic
- Reçoit et affiche les messages
- Envoie des accusés de réception

#### `test_wildcard.py`

Test de la souscription wildcard (`*`).

```bash
python3 tests/test_wildcard.py
```

- Souscrit à tous les topics via `*`
- Rejoint la room `__all__`
- Affiche tous les messages reçus

#### `test_specific_topic.py`

Test d'un topic spécifique.

```bash
python3 tests/test_specific_topic.py
```

- Souscrit au topic `BotMonitoringCycleStarted`
- Rejoint uniquement cette room
- Affiche les messages du topic

### 2. Tests de Performance

#### `perf_test.py`

Test de performance standard.

```bash
make perf
# ou
python3 tests/perf_test.py
```

**Configuration:**

- 5 publishers
- 10 subscribers
- 100 messages par publisher
- Total: 500 messages

**Métriques mesurées:**

- Débit (throughput)
- Latence (min, max, moyenne, médiane, percentiles)
- Distribution des messages par subscriber
- Performance des endpoints REST

**Résultats attendus:**

- Débit: ~150-200 msg/s (publish)
- Latence: 30-40ms (moyenne sous charge)
- 100% de livraison

#### `stress_test.py`

Test de stress sous charge élevée.

```bash
make stress
# ou
python3 tests/stress_test.py
```

**Configuration:**

- 10 publishers
- 50 subscribers
- 30 secondes de durée
- ~1000 msg/s ciblé

**Monitoring en temps réel:**

- Affichage des stats toutes les 5 secondes
- Compteurs de messages envoyés/reçus
- Taux d'erreurs
- Connexions actives

**Résultats attendus:**

- Débit: ~1000 msg/s (réception)
- 0 erreur serveur
- Taux de succès: 100%

#### `latency_analysis.py`

Analyse détaillée de la latence.

```bash
make latency
# ou
python3 tests/latency_analysis.py
```

**Mesures:**

- Latence HTTP (publish)
- Latence Socket.IO (delivery)
- Latence end-to-end totale
- Statistiques détaillées (min, max, moyenne, médiane, stdev, percentiles)

**Décomposition:**

```
Total (~9.5ms):
├─ HTTP Publish: ~5.3ms
│  ├─ Parsing JSON
│  ├─ Validation
│  ├─ DB async send
│  └─ HTTP overhead
└─ Socket.IO: ~5.8ms
   ├─ Namespace lookup
   ├─ Room emits (parallel)
   ├─ Network
   └─ Client parsing
```

**Résultats attendus:**

- HTTP: 5-6ms
- Socket.IO: 5-6ms
- **Total: 9-11ms** ✓

## Commandes Makefile

```bash
# Installer les dépendances
make install

# Lancer le client de démo
make demo

# Tests de performance
make perf      # Test standard
make stress    # Test de stress
make latency   # Analyse de latence
```

## Interprétation des Résultats

### Latence

| Latence | Interprétation |
|---------|----------------|
| <10ms   | Excellent ✓    |
| 10-20ms | Très bon       |
| 20-50ms | Bon            |
| >50ms   | À investiguer  |

### Débit

| Débit (réception) | Interprétation |
|-------------------|----------------|
| >1000 msg/s       | Excellent ✓    |
| 500-1000 msg/s    | Très bon       |
| 200-500 msg/s     | Bon            |
| <200 msg/s        | À investiguer  |

### Utilisation Mémoire

| Mémoire RSS | Interprétation |
|-------------|----------------|
| <10 MB      | Excellent ✓    |
| 10-50 MB    | Très bon       |
| 50-100 MB   | Bon            |
| >100 MB     | À investiguer  |

## Troubleshooting

### Le serveur ne reçoit pas de connexions

```bash
# Vérifier que le serveur tourne
make dev

# Vérifier le port
lsof -i:5000
```

### Erreur "Address already in use"

```bash
# Tuer les processus sur le port 5000
make kill-port

# Redémarrer proprement
make fresh
make dev
```

### Latence élevée (>50ms)

1. Vérifier la charge CPU
2. Vérifier les connexions réseau
3. Exécuter `latency_analysis.py` pour identifier la source
4. Consulter `PERFORMANCE.md` pour les optimisations

### Messages non reçus

1. Vérifier les logs du serveur
2. Vérifier que le client souscrit correctement
3. Vérifier que les rooms sont correctes (`*` → `__all__`)
4. Tester avec `test_wildcard.py` d'abord

## Exemples de Sortie

### perf_test.py

```
============================================================
PubSub Server Performance Test
============================================================
Publishers: 5
Subscribers: 10
Messages per publisher: 100
Total messages: 500
Topics: 5
============================================================

Throughput:
  Duration: 2.99s
  Messages sent: 500
  Throughput: 167.35 msg/s (publish)
  Throughput: 334.69 msg/s (receive)

Latency (ms):
  Mean: 34.84
  Median: 32.64
  P95: 69.80
  P99: 86.53
```

### latency_analysis.py

```
LATENCY BREAKDOWN ANALYSIS
======================================================================

1. HTTP Publish Latency (request/response):
   Mean:   5.29ms
   Median: 5.33ms

2. Socket.IO Delivery Latency (emit to receive):
   Mean:   5.84ms
   Median: 6.06ms

3. Total End-to-End Latency:
   Mean:   9.56ms
   Median: 9.37ms
```

## Fichiers Générés

Les tests peuvent générer ces fichiers:

- `pubsub.db` - Base de données SQLite
- `pubsub.db-shm`, `pubsub.db-wal` - Fichiers SQLite temporaires

Pour nettoyer:

```bash
make clean-db
```
