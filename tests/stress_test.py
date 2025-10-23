#!/usr/bin/env python3
"""
Stress test for PubSub server
Tests high load scenarios
"""
import socketio
import time
import threading
import requests
import json
import sys

# Heavy load configuration
NUM_PUBLISHERS = 10
NUM_SUBSCRIBERS = 50
MESSAGES_PER_PUBLISHER = 200
DURATION = 30  # seconds

stats = {
    'messages_sent': 0,
    'messages_received': 0,
    'errors': 0,
    'start_time': None,
    'subscribers_connected': 0
}
lock = threading.Lock()


def subscriber_thread(subscriber_id):
    """Subscribe and receive messages"""
    sio = socketio.Client(reconnection=False)

    @sio.event
    def connect():
        with lock:
            stats['subscribers_connected'] += 1

        # Half subscribe to wildcard, half to specific topics
        if subscriber_id % 2 == 0:
            topics = ['*']
        else:
            topics = [f'topic{subscriber_id % 5}']

        sio.emit('subscribe', {
            'consumer': f'subscriber-{subscriber_id}',
            'topics': topics
        })

    @sio.event
    def message(data):
        with lock:
            stats['messages_received'] += 1

        if isinstance(data, str):
            msg = json.loads(data)
        else:
            msg = data

        # Send consumed acknowledgment
        sio.emit('consumed', {
            'consumer': f'subscriber-{subscriber_id}',
            'topic': msg.get('topic', ''),
            'message_id': msg.get('message_id', ''),
            'message': msg.get('message', '')
        })

    try:
        sio.connect('http://localhost:5000', wait_timeout=10)
        time.sleep(DURATION + 5)
    except Exception as e:
        with lock:
            stats['errors'] += 1
        print(f"Subscriber {subscriber_id} error: {e}")
    finally:
        try:
            sio.disconnect()
        except:
            pass


def publisher_thread(publisher_id):
    """Continuously publish messages"""
    start = time.time()
    msg_count = 0

    while time.time() - start < DURATION:
        topic = f'topic{msg_count % 5}'
        payload = {
            'topic': topic,
            'message_id': f'msg-{publisher_id}-{msg_count}',
            'producer': f'publisher-{publisher_id}',
            'message': {
                'index': msg_count,
                'publisher': publisher_id,
                'timestamp': time.time()
            }
        }

        try:
            response = requests.post(
                'http://localhost:5000/publish',
                json=payload,
                timeout=2
            )
            if response.status_code == 200:
                with lock:
                    stats['messages_sent'] += 1
            else:
                with lock:
                    stats['errors'] += 1
        except Exception as e:
            with lock:
                stats['errors'] += 1

        msg_count += 1
        time.sleep(0.01)  # 100 msg/s per publisher


def monitor_thread():
    """Monitor and report stats in real-time"""
    last_sent = 0
    last_received = 0

    while True:
        time.sleep(5)
        with lock:
            sent = stats['messages_sent']
            received = stats['messages_received']
            errors = stats['errors']
            connected = stats['subscribers_connected']

        sent_rate = (sent - last_sent) / 5
        received_rate = (received - last_received) / 5

        print(f"[{time.strftime('%H:%M:%S')}] "
              f"Sent: {sent} (+{sent_rate:.1f}/s) | "
              f"Received: {received} (+{received_rate:.1f}/s) | "
              f"Errors: {errors} | "
              f"Subscribers: {connected}/{NUM_SUBSCRIBERS}")
        sys.stdout.flush()

        last_sent = sent
        last_received = received


def run_stress_test():
    """Run stress test"""
    print("=" * 70)
    print("PubSub Server STRESS TEST")
    print("=" * 70)
    print(f"Duration: {DURATION}s")
    print(f"Publishers: {NUM_PUBLISHERS}")
    print(f"Subscribers: {NUM_SUBSCRIBERS}")
    print(f"Target rate: ~{NUM_PUBLISHERS * 100} msg/s")
    print("=" * 70)

    stats['start_time'] = time.time()

    # Start monitor
    monitor = threading.Thread(target=monitor_thread, daemon=True)
    monitor.start()

    # Start subscribers
    print("\nStarting subscribers...")
    subscriber_threads = []
    for i in range(NUM_SUBSCRIBERS):
        t = threading.Thread(target=subscriber_thread, args=(i,), daemon=True)
        t.start()
        subscriber_threads.append(t)

    # Wait for subscribers to connect
    time.sleep(5)
    print(f"✓ {stats['subscribers_connected']}/{NUM_SUBSCRIBERS} subscribers connected")

    # Start publishers
    print(f"\nStarting stress test for {DURATION}s...")
    print("Real-time stats:")
    print("-" * 70)

    publisher_threads = []
    for i in range(NUM_PUBLISHERS):
        t = threading.Thread(target=publisher_thread, args=(i,))
        t.start()
        publisher_threads.append(t)

    # Wait for publishers to finish
    for t in publisher_threads:
        t.join()

    print("-" * 70)
    print("\n✓ Stress test complete, waiting for message delivery...")
    time.sleep(5)

    # Final report
    duration = time.time() - stats['start_time']

    print("\n" + "=" * 70)
    print("STRESS TEST RESULTS")
    print("=" * 70)
    print(f"Duration: {duration:.2f}s")
    print(f"Messages sent: {stats['messages_sent']}")
    print(f"Messages received: {stats['messages_received']}")
    print(f"Errors: {stats['errors']}")
    print(f"Throughput (send): {stats['messages_sent'] / duration:.2f} msg/s")
    print(f"Throughput (receive): {stats['messages_received'] / duration:.2f} msg/s")
    print(f"Subscribers connected: {stats['subscribers_connected']}/{NUM_SUBSCRIBERS}")

    success_rate = (stats['messages_sent'] / (stats['messages_sent'] + stats['errors']) * 100) if (stats['messages_sent'] + stats['errors']) > 0 else 0
    print(f"Success rate: {success_rate:.2f}%")

    # Check server resources
    print("\n" + "=" * 70)


if __name__ == '__main__':
    try:
        run_stress_test()
    except KeyboardInterrupt:
        print("\n\nTest interrupted")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback

        traceback.print_exc()
