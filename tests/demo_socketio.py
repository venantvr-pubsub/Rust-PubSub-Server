#!/usr/bin/env python3
"""
Demo client for Socket.IO - Shows connection and message reception
"""
import socketio
import time
import sys

# Create a Socket.IO client with logging
sio = socketio.Client(logger=False, engineio_logger=False)


@sio.event
def connect():
    print("✓ Connected to Socket.IO server!")
    sys.stdout.flush()

    # Subscribe to topics
    print("Subscribing to topic: 'demo-topic'")
    sys.stdout.flush()
    sio.emit('subscribe', {
        'event': 'subscribe',
        'consumer': 'python-demo-client',
        'topics': ['demo-topic']
    })


@sio.event
def subscribed(data):
    print(f"✓ Subscription confirmed: {data}")
    sys.stdout.flush()


@sio.event
def message(data):
    print(f"\n📨 MESSAGE RECEIVED!")
    print(f"   Content: {data}")
    sys.stdout.flush()

    # Parse the message and send consumption acknowledgment
    import json

    try:
        if isinstance(data, str):
            msg = json.loads(data)
        else:
            msg = data

        # Send consumed event back to server
        consumed_data = {
            'consumer': 'python-demo-client',
            'topic': msg.get('topic', ''),
            'message_id': msg.get('message_id', ''),
            'message': msg.get('message', '')
        }
        sio.emit('consumed', consumed_data)
        print(f"   ✓ Sent consumption acknowledgment for message {msg.get('message_id', 'unknown')}")
        sys.stdout.flush()
    except Exception as e:
        print(f"   ✗ Error sending acknowledgment: {e}")
        sys.stdout.flush()


@sio.event
def disconnect():
    print("✗ Disconnected from server")
    sys.stdout.flush()


@sio.event
def connect_error(data):
    print(f"✗ Connection error: {data}")
    sys.stdout.flush()


if __name__ == '__main__':
    try:
        print("=" * 60)
        print("Socket.IO Client Demo")
        print("=" * 60)
        print("Connecting to http://localhost:5000...")
        sys.stdout.flush()

        sio.connect('http://localhost:5000')

        print("\n✓ Client ready! Waiting for messages on 'demo-topic'...")
        print("  To test, run in another terminal:")
        print("  curl -X POST http://localhost:5000/publish \\")
        print("    -H 'Content-Type: application/json' \\")
        print("    -d '{\"topic\": \"demo-topic\", \"message_id\": \"msg-1\", \"message\": \"Test message\", \"producer\": \"curl\"}'")
        print("\nPress Ctrl+C to stop.\n")
        sys.stdout.flush()

        # Keep alive
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n\nShutting down client...")
        sys.stdout.flush()
        sio.disconnect()
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
        sys.stdout.flush()
