#!/usr/bin/env python3
"""
Test client for wildcard subscription (*)
"""
import socketio
import json
import sys

sio = socketio.Client()


@sio.event
def connect():
    print("✓ Connected!")
    # Subscribe to wildcard to receive ALL messages
    sio.emit('subscribe', {
        'consumer': 'wildcard-listener',
        'topics': ['*']
    })
    print("📝 Subscribed to '*' (wildcard - all topics)")
    sys.stdout.flush()


@sio.event
def subscribed(data):
    print(f"✓ Subscription confirmed: {data}")
    sys.stdout.flush()


@sio.event
def message(data):
    print(f"\n📨 WILDCARD MESSAGE RECEIVED!")
    sys.stdout.flush()

    try:
        if isinstance(data, str):
            msg = json.loads(data)
        else:
            msg = data

        print(f"   Topic: {msg.get('topic', 'N/A')}")
        print(f"   Message ID: {msg.get('message_id', 'N/A')}")
        print(f"   Producer: {msg.get('producer', 'N/A')}")
        print(f"   Message: {msg.get('message', 'N/A')}")
        sys.stdout.flush()

        # Send acknowledgment
        sio.emit('consumed', {
            'consumer': 'wildcard-listener',
            'topic': msg.get('topic', ''),
            'message_id': msg.get('message_id', ''),
            'message': msg.get('message', '')
        })
        print(f"   ✓ Sent acknowledgment")
        sys.stdout.flush()
    except Exception as e:
        print(f"   ✗ Error: {e}")
        import traceback

        traceback.print_exc()
        sys.stdout.flush()


@sio.event
def disconnect():
    print("✗ Disconnected")
    sys.stdout.flush()


if __name__ == '__main__':
    try:
        print("=" * 60)
        print("Testing Wildcard (*) subscription")
        print("=" * 60)
        sio.connect('http://localhost:5000')
        print("\n✓ Listening to ALL topics... Press Ctrl+C to stop.\n")
        sys.stdout.flush()

        import time

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n\nStopping...")
        sio.disconnect()
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
