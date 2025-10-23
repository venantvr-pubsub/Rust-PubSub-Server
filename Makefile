.PHONY: help build run dev release clean stop kill-port test demo client install check fmt clippy perf stress latency

# Variables
PORT := 5000
BINARY := pubsub_server
DB_FILE := pubsub.db
TESTS_DIR := tests

help:
	@echo "Available commands:"
	@echo "  make build       - Build the project in debug mode"
	@echo "  make release     - Build the project in release mode"
	@echo "  make run         - Stop any running server and run in debug mode"
	@echo "  make dev         - Stop any running server and run in release mode"
	@echo "  make stop        - Stop the running server"
	@echo "  make kill-port   - Kill any process using port $(PORT)"
	@echo "  make clean       - Clean build artifacts and database"
	@echo "  make clean-db    - Remove only the database file"
	@echo "  make test        - Run tests"
	@echo "  make demo        - Run the Python Socket.IO demo client"
	@echo "  make client      - Install Python dependencies and run demo client"
	@echo "  make install     - Install Python dependencies"
	@echo "  make perf        - Run performance test"
	@echo "  make stress      - Run stress test"
	@echo "  make latency     - Run latency analysis"
	@echo "  make check       - Run cargo check"
	@echo "  make fmt         - Format the code"
	@echo "  make clippy      - Run clippy linter"

build:
	@echo "Building in debug mode..."
	cargo build

release:
	@echo "Building in release mode..."
	cargo build --release

run: stop
	@echo "Starting server in debug mode..."
	@cargo run

dev: stop
	@echo "Starting server in release mode..."
	@./target/release/$(BINARY) 2>&1 || ($(MAKE) release && ./target/release/$(BINARY))

stop:
	@echo "Stopping any running servers..."
	@pkill -9 $(BINARY) 2>/dev/null || true
	@sleep 1

kill-port:
	@echo "Killing process on port $(PORT)..."
	@lsof -ti:$(PORT) | xargs kill -9 2>/dev/null || true
	@sleep 1

clean: stop
	@echo "Cleaning build artifacts and database..."
	cargo clean
	rm -f $(DB_FILE) $(DB_FILE)-shm $(DB_FILE)-wal

clean-db:
	@echo "Removing database files..."
	rm -f $(DB_FILE) $(DB_FILE)-shm $(DB_FILE)-wal

test:
	@echo "Running tests..."
	cargo test

demo: client

client:
	@echo "Running Python Socket.IO demo client..."
	@python3 $(TESTS_DIR)/demo_socketio.py

install:
	@echo "Installing Python dependencies..."
	pip3 install --break-system-packages python-socketio requests

perf:
	@echo "Running performance test..."
	@python3 $(TESTS_DIR)/perf_test.py

stress:
	@echo "Running stress test..."
	@python3 $(TESTS_DIR)/stress_test.py

latency:
	@echo "Running latency analysis..."
	@python3 $(TESTS_DIR)/latency_analysis.py

check:
	@echo "Running cargo check..."
	cargo check

fmt:
	@echo "Formatting code..."
	cargo fmt

clippy:
	@echo "Running clippy..."
	cargo clippy -- -D warnings

# Fresh start - kill everything, clean DB, and rebuild
fresh: stop kill-port clean-db
	@echo "Fresh start: cleaning and rebuilding..."
	@$(MAKE) release
	@echo "Ready to run with: make dev"
