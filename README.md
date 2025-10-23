# Rust Pub/Sub Server

A high-performance publish/subscribe messaging server built with Rust, featuring real-time WebSocket communication and a web-based monitoring interface.

## Features

- **High Performance**: Built with Axum and Tokio for async I/O
- **In-Memory Database**: SQLite in-memory mode by default (configurable)
- **Automatic Data Purging**: Prevents memory growth with size and time-based limits
- **Real-time Monitoring**: WebSocket-powered dashboards
- **Embedded Assets**: Single binary with all web assets included
- **Docker Support**: Multi-stage build for minimal image size
- **Health Checks**: Built-in health endpoint

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Start the server
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the server
docker-compose down
```

The server will be available at `http://localhost:5000`

### Using Docker

```bash
# Build the image
docker build -t pubsub-server .

# Run the container
docker run -d -p 5000:5000 --name pubsub-server pubsub-server

# View logs
docker logs -f pubsub-server

# Stop and remove
docker stop pubsub-server && docker rm pubsub-server
```

### Using Cargo

```bash
# Build release
cargo build --release

# Run the server
./target/release/pubsub_server
```

## Configuration

### Environment Variables

- `DATABASE_FILE`: Database file path (default: `:memory:`)
- `RUST_LOG`: Logging level (default: `info`)

### Persistent Database

To use a persistent database instead of in-memory:

**With Docker Compose:**

Edit `docker-compose.yml` and uncomment the volume and DATABASE_FILE sections:

```yaml
environment:
  DATABASE_FILE: /data/pubsub.db
volumes:
  - ./data:/data
```

**With Docker:**

```bash
docker run -d -p 5000:5000 \
  -v $(pwd)/data:/data \
  -e DATABASE_FILE=/data/pubsub.db \
  pubsub-server
```

**With Cargo:**

```bash
DATABASE_FILE=pubsub.db ./target/release/pubsub_server
```

## Data Purging

The server automatically purges old data to prevent unbounded memory growth:

- **Max Messages**: 10,000
- **Max Consumptions**: 10,000
- **Max Age**: 24 hours
- **Purge Interval**: Every 30 minutes

These limits are applied with OR logic - data is deleted if it exceeds EITHER the count limit OR the age limit.

Configuration constants are in `src/broker.rs`:

```rust
const MAX_MESSAGES: i64 = 10_000;
const MAX_CONSUMPTIONS: i64 = 10_000;
const MAX_AGE_HOURS: f64 = 24.0;
const PURGE_INTERVAL_MINUTES: u64 = 30;
```

## API Endpoints

### REST API

- `POST /publish` - Publish a message to a topic
- `GET /clients` - List connected clients
- `GET /messages` - Get recent messages (cached, 2s TTL)
- `GET /consumptions` - Get consumption history (cached, 2s TTL)
- `GET /graph/state` - Get graph state for visualization (cached, 2s TTL)
- `GET /health` - Health check endpoint

### WebSocket

- `GET /ws` - WebSocket endpoint for real-time subscriptions

### Web Interface

- `http://localhost:5000/control-panel.html` - Main control panel
- `http://localhost:5000/activity-map.html` - Activity visualization
- `http://localhost:5000/circular-graph.html` - Circular graph view

## Example Usage

### Publishing a Message

```bash
curl -X POST http://localhost:5000/publish \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "events",
    "message_id": "msg-001",
    "message": {"text": "Hello World"},
    "producer": "my-producer"
  }'
```

### Health Check

```bash
curl http://localhost:5000/health
```

## Architecture

- **Multi-stage Docker build**: Separates build and runtime for minimal image size
- **Batch writes**: Database operations batched every 20ms or 500 commands
- **Query caching**: 2-second TTL cache for expensive queries
- **Non-blocking purge**: Background task for data cleanup
- **Single binary**: All assets embedded using `rust-embed`

## Project Structure

```
.
├── Cargo.toml
├── Cargo.lock
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── src/
│   ├── main.rs           # Entry point and routing
│   ├── broker.rs         # Core pub/sub logic
│   ├── handlers.rs       # HTTP handlers
│   ├── websocket.rs      # WebSocket handling
│   ├── database.rs       # Database initialization
│   ├── models.rs         # Data structures
│   ├── cache.rs          # Query cache
│   ├── app_state.rs      # Shared state
│   └── embedded.rs       # Asset embedding
├── migrations/
│   └── 001_add_message_id_and_producer.sql
├── static/               # CSS/JS files
└── *.html                # Web interfaces
```

## Dependencies

- **axum**: Web framework
- **tokio**: Async runtime
- **sqlx**: Database access
- **socketio**: WebSocket support
- **rust-embed**: Asset embedding
- **serde**: Serialization

## License

MIT
