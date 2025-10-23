#!/usr/bin/env python3
"""
Performance test for PubSub server
Tests throughput, latency, and resource usage
"""
import socketio
import time
import threading
import statistics
import requests
import json
from collections import defaultdict

# Test configuration
NUM_PUBLISHERS = 5
NUM_SUBSCRIBERS = 10
MESSAGES_PER_PUBLISHER = 100
TOPICS = ["topic1", "topic2", "topic3", "topic4", "topic5"]

# Metrics
received_messages = defaultdict(list)
latencies = []
lock = threading.Lock()
start_time = None
end_time = None


def subscriber_thread(subscriber_id, topic):
    """Subscribe and receive messages"""
    sio = socketio.Client()

    @sio.event
    def connect():
        sio.emit('subscribe', {
            'consumer': f'subscriber-{subscriber_id}',
            'topics': [topic]
        })

    @sio.event
    def message(data):
        receive_time = time.time()
        if isinstance(data, str):
            msg = json.loads(data)
        else:
            msg = data

        send_time = float(msg.get('message', {}).get('timestamp', 0))
        if send_time > 0:
            latency = (receive_time - send_time) * 1000  # ms
            with lock:
                latencies.append(latency)
                received_messages[subscriber_id].append(msg['message_id'])

        # Send consumed acknowledgment
        sio.emit('consumed', {
            'consumer': f'subscriber-{subscriber_id}',
            'topic': msg.get('topic', ''),
            'message_id': msg.get('message_id', ''),
            'message': msg.get('message', '')
        })

    try:
        sio.connect('http://localhost:5000')
        time.sleep(30)  # Wait for messages
    except Exception as e:
        print(f"Subscriber {subscriber_id} error: {e}")
    finally:
        try:
            sio.disconnect()
        except:
            pass


def publisher_thread(publisher_id):
    """Publish messages via REST API"""
    global start_time, end_time

    for i in range(MESSAGES_PER_PUBLISHER):
        topic = TOPICS[i % len(TOPICS)]
        payload = {
            'topic': topic,
            'message_id': f'msg-{publisher_id}-{i}',
            'producer': f'publisher-{publisher_id}',
            'message': {
                'index': i,
                'timestamp': time.time()
            }
        }

        if start_time is None:
            start_time = time.time()

        try:
            response = requests.post(
                'http://localhost:5000/publish',
                json=payload,
                timeout=5
            )
            if response.status_code != 200:
                print(f"Publish error: {response.status_code}")
        except Exception as e:
            print(f"Publisher {publisher_id} error: {e}")

    end_time = time.time()


def run_performance_test():
    """Run comprehensive performance test"""
    global start_time, end_time

    print("=" * 60)
    print("PubSub Server Performance Test")
    print("=" * 60)
    print(f"Publishers: {NUM_PUBLISHERS}")
    print(f"Subscribers: {NUM_SUBSCRIBERS}")
    print(f"Messages per publisher: {MESSAGES_PER_PUBLISHER}")
    print(f"Total messages: {NUM_PUBLISHERS * MESSAGES_PER_PUBLISHER}")
    print(f"Topics: {len(TOPICS)}")
    print("=" * 60)

    # Start subscribers
    print("\nStarting subscribers...")
    subscriber_threads = []
    for i in range(NUM_SUBSCRIBERS):
        topic = TOPICS[i % len(TOPICS)]
        t = threading.Thread(target=subscriber_thread, args=(i, topic))
        t.daemon = True
        t.start()
        subscriber_threads.append(t)

    time.sleep(3)  # Wait for subscribers to connect
    print(f"✓ {NUM_SUBSCRIBERS} subscribers connected")

    # Start publishers
    print("\nStarting publishers...")
    publisher_threads = []
    for i in range(NUM_PUBLISHERS):
        t = threading.Thread(target=publisher_thread, args=(i,))
        t.start()
        publisher_threads.append(t)

    # Wait for publishers to finish
    for t in publisher_threads:
        t.join()

    print("✓ All messages published")

    # Wait for message delivery
    print("\nWaiting for message delivery...")
    time.sleep(5)

    # Calculate metrics
    print("\n" + "=" * 60)
    print("PERFORMANCE RESULTS")
    print("=" * 60)

    duration = end_time - start_time
    total_messages_sent = NUM_PUBLISHERS * MESSAGES_PER_PUBLISHER
    total_messages_received = sum(len(msgs) for msgs in received_messages.values())

    print(f"\nThroughput:")
    print(f"  Duration: {duration:.2f}s")
    print(f"  Messages sent: {total_messages_sent}")
    print(f"  Messages received: {total_messages_received}")
    print(f"  Throughput: {total_messages_sent / duration:.2f} msg/s (publish)")
    print(f"  Throughput: {total_messages_received / duration:.2f} msg/s (receive)")

    if latencies:
        print(f"\nLatency (ms):")
        print(f"  Min: {min(latencies):.2f}")
        print(f"  Max: {max(latencies):.2f}")
        print(f"  Mean: {statistics.mean(latencies):.2f}")
        print(f"  Median: {statistics.median(latencies):.2f}")
        if len(latencies) > 1:
            print(f"  Stdev: {statistics.stdev(latencies):.2f}")

        # Percentiles
        sorted_latencies = sorted(latencies)
        p50 = sorted_latencies[int(len(sorted_latencies) * 0.50)]
        p95 = sorted_latencies[int(len(sorted_latencies) * 0.95)]
        p99 = sorted_latencies[int(len(sorted_latencies) * 0.99)]
        print(f"  P50: {p50:.2f}")
        print(f"  P95: {p95:.2f}")
        print(f"  P99: {p99:.2f}")

    print(f"\nSubscriber message counts:")
    for sub_id, msgs in sorted(received_messages.items()):
        print(f"  Subscriber {sub_id}: {len(msgs)} messages")

    # Check API endpoints performance
    print(f"\nAPI Endpoint Performance:")

    endpoints = [
        ('/health', 'Health check'),
        ('/clients', 'Get clients'),
        ('/messages', 'Get messages'),
        ('/consumptions', 'Get consumptions'),
        ('/graph/state', 'Graph state')
    ]

    for endpoint, description in endpoints:
        times = []
        for _ in range(10):
            start = time.time()
            try:
                response = requests.get(f'http://localhost:5000{endpoint}', timeout=5)
                elapsed = (time.time() - start) * 1000
                if response.status_code == 200:
                    times.append(elapsed)
            except:
                pass

        if times:
            print(f"  {description}: {statistics.mean(times):.2f}ms (avg)")

    print("\n" + "=" * 60)


if __name__ == '__main__':
    try:
        run_performance_test()
    except KeyboardInterrupt:
        print("\n\nTest interrupted")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback

        traceback.print_exc()
