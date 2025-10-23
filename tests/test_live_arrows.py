#!/usr/bin/env python3
"""
Test script to generate live messages for viewing arrows in real-time on circular-graph
"""

import socketio
import requests
import time

SERVER_URL = 'http://localhost:5000'


def generate_live_traffic():
    """Generate continuous traffic to see arrows"""

    # Create a subscriber
    sio = socketio.Client()

    @sio.on('connect')
    def on_connect():
        print('✓ Subscriber connected')
        sio.emit('subscribe', {
            'consumer': 'ArrowTestConsumer',
            'topics': ['orders', 'inventory', 'shipping']
        })

    @sio.on('message')
    def on_message(data):
        print(f'  → Received: {data["topic"]}')

    sio.connect(SERVER_URL)
    time.sleep(1)

    print('\n🎯 Starting to publish messages...')
    print('👀 Open http://localhost:5000/circular-graph.html to see the arrows!\n')

    topics = ['orders', 'inventory', 'shipping']
    producers = ['WebApp', 'MobileApp', 'AdminPanel']

    for i in range(20):
        topic = topics[i % len(topics)]
        producer = producers[i % len(producers)]

        message = {
            'topic': topic,
            'message_id': f'arrow-test-{i}',
            'message': {'text': f'Live message {i}', 'count': i},
            'producer': producer
        }

        response = requests.post(f'{SERVER_URL}/publish', json=message)
        if response.status_code == 200:
            print(f'✓ [{producer}] → [{topic}] (message {i})')

        time.sleep(1.5)  # Pause between messages to see arrows

    print('\n✓ Finished! The arrows should have been visible on the circular-graph.')

    sio.disconnect()


if __name__ == '__main__':
    print('=' * 60)
    print('  CIRCULAR GRAPH - LIVE ARROWS TEST')
    print('=' * 60)
    print('\n📍 Make sure you have http://localhost:5000/circular-graph.html')
    print('   open in your browser BEFORE starting!\n')

    input('Press ENTER when ready...')

    try:
        generate_live_traffic()
    except Exception as e:
        print(f'\n✗ Error: {e}')
        import traceback

        traceback.print_exc()
