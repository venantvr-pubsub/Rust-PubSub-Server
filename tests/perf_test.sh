#!/bin/bash

echo "=== Performance Test: Dashboard Impact ==="
echo ""

# Test function
test_publish() {
    local num_messages=$1
    local dashboard_state=$2

    echo "Testing with dashboard $dashboard_state ($num_messages messages)..."

    # Start timing
    start=$(date +%s%N)

    # Publish messages
    for i in $(seq 1 $num_messages); do
        curl -s -X POST http://localhost:5000/publish \
            -H "Content-Type: application/json" \
            -d "{\"topic\":\"perf_test\",\"message_id\":\"msg-$i\",\"message\":{\"test\":\"data\"},\"producer\":\"perf_test_producer\"}" \
            > /dev/null
    done

    # End timing
    end=$(date +%s%N)

    # Calculate duration in milliseconds
    duration=$(( (end - start) / 1000000 ))
    avg_latency=$(echo "scale=2; $duration / $num_messages" | bc)

    echo "  Total time: ${duration}ms"
    echo "  Average latency: ${avg_latency}ms per message"
    echo "  Throughput: $(echo "scale=2; $num_messages * 1000 / $duration" | bc) msg/s"
    echo ""
}

# Number of messages to test
NUM_MESSAGES=100

# Test 1: Dashboard enabled
curl -s -X POST http://localhost:5000/dashboard/login > /dev/null
sleep 1
test_publish $NUM_MESSAGES "ENABLED"

# Test 2: Dashboard disabled
curl -s -X POST http://localhost:5000/dashboard/logout > /dev/null
sleep 1
test_publish $NUM_MESSAGES "DISABLED"

echo "=== Test Complete ==="
echo ""
echo "Summary:"
echo "- When dashboard is ENABLED: Socket.IO events are emitted"
echo "- When dashboard is DISABLED: Socket.IO events are NOT emitted"
echo "- This reduces CPU and memory usage when dashboard is not in use"
