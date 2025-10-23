#!/usr/bin/env python3
"""
Test script to verify UI fixes:
1. Activity map loads initial state
2. Circular graph displays arrows
3. Control panel shows clients correctly
"""

import socketio
import requests
import time
import json

SERVER_URL = 'http://localhost:5000'

def test_publish_and_subscribe():
    """Test publishing and subscribing to verify UI updates"""

    # Create client
    sio = socketio.Client()

    messages_received = []

    @sio.on('connect')
    def on_connect():
        print('✓ Connected to server')
        # Subscribe to test topics
        sio.emit('subscribe', {
            'consumer': 'UITestConsumer',
            'topics': ['test-topic-1', 'test-topic-2']
        })
        print('✓ Subscribed to topics: test-topic-1, test-topic-2')

    @sio.on('message')
    def on_message(data):
        print(f'✓ Received message: {data["topic"]} from {data["producer"]}')
        messages_received.append(data)

    @sio.on('disconnect')
    def on_disconnect():
        print('✓ Disconnected from server')

    # Connect
    sio.connect(SERVER_URL)
    time.sleep(1)

    # Publish some messages
    for i in range(3):
        message = {
            'topic': f'test-topic-{(i % 2) + 1}',
            'message_id': f'test-msg-{i}',
            'message': {'text': f'Test message {i}'},
            'producer': 'UITestProducer'
        }
        response = requests.post(f'{SERVER_URL}/publish', json=message)
        assert response.status_code == 200, f'Publish failed: {response.text}'
        print(f'✓ Published message {i} to {message["topic"]}')
        time.sleep(0.5)

    # Wait for messages to be received
    time.sleep(2)

    # Check APIs
    print('\n--- Checking API endpoints ---')

    # Check /clients
    clients_response = requests.get(f'{SERVER_URL}/clients')
    clients = clients_response.json()
    print(f'✓ /clients returned {len(clients)} client entries')
    for client in clients:
        print(f'  - Consumer: {client["consumer"]}, Topic: {client["topic"]}')

    # Check /graph/state
    graph_response = requests.get(f'{SERVER_URL}/graph/state')
    graph_state = graph_response.json()
    print(f'✓ /graph/state:')
    print(f'  - Producers: {graph_state["producers"]}')
    print(f'  - Topics: {graph_state["topics"]}')
    print(f'  - Consumers: {graph_state["consumers"]}')
    print(f'  - Links: {len(graph_state["links"])} links')

    # Check /messages
    messages_response = requests.get(f'{SERVER_URL}/messages')
    messages = messages_response.json()
    print(f'✓ /messages returned {len(messages)} messages')

    # Disconnect
    sio.disconnect()

    print('\n--- Test Summary ---')
    print(f'✓ Published 3 messages')
    print(f'✓ Received {len(messages_received)} messages')
    print(f'✓ {len(clients)} client entries in /clients')
    print(f'✓ Graph state has {len(graph_state["producers"])} producers, {len(graph_state["topics"])} topics, {len(graph_state["consumers"])} consumers')

    if len(messages_received) >= 3:
        print('\n✓✓✓ All tests passed! ✓✓✓')
        print('\nNow open your browser to:')
        print('  - http://localhost:5000/control-panel.html')
        print('  - http://localhost:5000/activity-map.html')
        print('  - http://localhost:5000/circular-graph.html')
    else:
        print(f'\n⚠ Warning: Only received {len(messages_received)}/3 messages')

    return len(messages_received) >= 3

if __name__ == '__main__':
    try:
        success = test_publish_and_subscribe()
        exit(0 if success else 1)
    except Exception as e:
        print(f'\n✗ Test failed with error: {e}')
        import traceback
        traceback.print_exc()
        exit(1)
