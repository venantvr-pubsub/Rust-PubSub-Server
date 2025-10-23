#!/usr/bin/env python3
"""
Test client for specific topic subscription
"""
import socketio
import json
import sys

sio = socketio.Client()


@sio.event
def connect():
    print("✓ Connected!")
    # Subscribe to the specific topic
    sio.emit('subscribe', {
        'consumer': 'test-bot-monitoring',
        'topics': ['BotMonitoringCycleStarted']
    })
    print("📝 Subscribed to 'BotMonitoringCycleStarted'")
    sys.stdout.flush()


@sio.event
def subscribed(data):
    print(f"✓ Subscription confirmed: {data}")
    sys.stdout.flush()


@sio.event
def message(data):
    print(f"\n📨 MESSAGE RECEIVED!")
    print(f"   Raw data: {data}")
    sys.stdout.flush()

    try:
        if isinstance(data, str):
            msg = json.loads(data)
        else:
            msg = data

        print(f"   Topic: {msg.get('topic', 'N/A')}")
        print(f"   Message ID: {msg.get('message_id', 'N/A')}")
        print(f"   Producer: {msg.get('producer', 'N/A')}")
        sys.stdout.flush()

        # Send acknowledgment
        sio.emit('consumed', {
            'consumer': 'test-bot-monitoring',
            'topic': msg.get('topic', ''),
            'message_id': msg.get('message_id', ''),
            'message': msg.get('message', '')
        })
        print(f"   ✓ Sent acknowledgment")
        sys.stdout.flush()
    except Exception as e:
        print(f"   ✗ Error: {e}")
        sys.stdout.flush()


@sio.event
def disconnect():
    print("✗ Disconnected")
    sys.stdout.flush()


if __name__ == '__main__':
    try:
        print("=" * 60)
        print("Testing BotMonitoringCycleStarted subscription")
        print("=" * 60)
        sio.connect('http://localhost:5000')
        print("\n✓ Waiting for messages... Press Ctrl+C to stop.\n")
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
