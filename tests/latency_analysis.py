#!/usr/bin/env python3
"""
Detailed latency analysis
Break down latency sources
"""
import socketio
import time
import requests
import json
import statistics

latencies = {
    'http_publish': [],
    'socketio_receive': [],
    'end_to_end': []
}

messages_received = []

sio = socketio.Client()


@sio.event
def connect():
    print("✓ Connected")
    sio.emit('subscribe', {
        'consumer': 'latency-tester',
        'topics': ['latency-test']
    })


@sio.event
def message(data):
    receive_time = time.time()
    if isinstance(data, str):
        msg = json.loads(data)
    else:
        msg = data

    send_time = float(msg.get('message', {}).get('send_time', 0))
    http_done_time = float(msg.get('message', {}).get('http_done_time', 0))

    if send_time > 0:
        end_to_end = (receive_time - send_time) * 1000
        latencies['end_to_end'].append(end_to_end)

        if http_done_time > 0:
            http_latency = (http_done_time - send_time) * 1000
            socketio_latency = (receive_time - http_done_time) * 1000
            latencies['http_publish'].append(http_latency)
            latencies['socketio_receive'].append(socketio_latency)

            print(f"Message {msg['message_id']}: "
                  f"HTTP={http_latency:.2f}ms, "
                  f"SocketIO={socketio_latency:.2f}ms, "
                  f"Total={end_to_end:.2f}ms")

    messages_received.append(msg['message_id'])


@sio.event
def subscribed(data):
    print(f"✓ Subscribed: {data}")


try:
    print("Connecting to server...")
    sio.connect('http://localhost:5000')
    time.sleep(2)

    print("\nSending test messages...\n")

    # Send messages with timing info
    for i in range(20):
        send_time = time.time()

        payload = {
            'topic': 'latency-test',
            'message_id': f'latency-msg-{i}',
            'producer': 'latency-analyzer',
            'message': {
                'index': i,
                'send_time': send_time
            }
        }

        response = requests.post(
            'http://localhost:5000/publish',
            json=payload,
            timeout=5
        )

        http_done_time = time.time()

        # Add http completion time to message for second pass
        payload['message']['http_done_time'] = http_done_time
        response = requests.post(
            'http://localhost:5000/publish',
            json=payload,
            timeout=5
        )

        time.sleep(0.1)

    print("\nWaiting for messages...")
    time.sleep(3)

    # Analysis
    print("\n" + "=" * 70)
    print("LATENCY BREAKDOWN ANALYSIS")
    print("=" * 70)

    if latencies['http_publish']:
        print(f"\n1. HTTP Publish Latency (request/response):")
        print(f"   Min:    {min(latencies['http_publish']):.2f}ms")
        print(f"   Max:    {max(latencies['http_publish']):.2f}ms")
        print(f"   Mean:   {statistics.mean(latencies['http_publish']):.2f}ms")
        print(f"   Median: {statistics.median(latencies['http_publish']):.2f}ms")

    if latencies['socketio_receive']:
        print(f"\n2. Socket.IO Delivery Latency (emit to receive):")
        print(f"   Min:    {min(latencies['socketio_receive']):.2f}ms")
        print(f"   Max:    {max(latencies['socketio_receive']):.2f}ms")
        print(f"   Mean:   {statistics.mean(latencies['socketio_receive']):.2f}ms")
        print(f"   Median: {statistics.median(latencies['socketio_receive']):.2f}ms")

    if latencies['end_to_end']:
        print(f"\n3. Total End-to-End Latency:")
        print(f"   Min:    {min(latencies['end_to_end']):.2f}ms")
        print(f"   Max:    {max(latencies['end_to_end']):.2f}ms")
        print(f"   Mean:   {statistics.mean(latencies['end_to_end']):.2f}ms")
        print(f"   Median: {statistics.median(latencies['end_to_end']):.2f}ms")

    print("\n" + "=" * 70)
    print("\nLatency Sources:")
    print("- HTTP Publish: REST API processing + DB write")
    print("- Socket.IO: emit() await + network + client receive")
    print("- Total: Full round trip from publish call to client receipt")
    print("=" * 70)

    # Test direct Socket.IO without DB
    print("\n\nTesting Socket.IO emit latency (bypassing HTTP)...")

    sio.disconnect()

except KeyboardInterrupt:
    print("\n\nInterrupted")
except Exception as e:
    print(f"\nError: {e}")
    import traceback

    traceback.print_exc()
finally:
    try:
        sio.disconnect()
    except:
        pass
