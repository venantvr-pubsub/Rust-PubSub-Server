#!/usr/bin/env python3
"""
Test client for Socket.IO connection to Rust PubSub Server
"""
import socketio
import time

# Create a Socket.IO client
sio = socketio.Client()


@sio.event
def connect():
    print("✓ Connected to Socket.IO server!")

    # Subscribe to topics
    print("Subscribing to topics: ['test-topic', 'news']")
    sio.emit('subscribe', {
        'event': 'subscribe',
        'consumer': 'python-test-client',
        'topics': ['test-topic', 'news']
    })


@sio.event
def subscribed(data):
    print(f"✓ Subscription confirmed: {data}")


@sio.event
def message(data):
    print(f"📨 Received message: {data}")

    # If the message has an id, send consumed acknowledgment
    # You'll need to parse the data to extract message details


@sio.event
def disconnect():
    print("✗ Disconnected from server")


@sio.event
def connect_error(data):
    print(f"✗ Connection error: {data}")


if __name__ == '__main__':
    try:
        print("Connecting to ws://localhost:5000...")
        sio.connect('http://localhost:5000')

        print("\nClient is running. Press Ctrl+C to stop.\n")

        # Keep the client running
        sio.wait()

    except KeyboardInterrupt:
        print("\n\nShutting down client...")
        sio.disconnect()
    except Exception as e:
        print(f"Error: {e}")
