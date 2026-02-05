#!/bin/bash
# Flow Detector Service Monitor
# Shows real-time status of all services and watch data stream

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

show_status() {
    clear
    echo "═══════════════════════════════════════════════════════════════"
    echo "              FLOW DETECTOR SERVICE MONITOR"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Service status
    echo "SERVICES:"
    for svc in flow-watch-relay flow-ambient-agent flow-rating-server; do
        if systemctl is-active --quiet $svc; then
            echo -e "  $svc: ${GREEN}● running${NC}"
        else
            echo -e "  $svc: ${RED}○ stopped${NC}"
        fi
    done

    echo ""
    echo "RELAY STATUS:"
    local relay_status=$(curl -s --connect-timeout 2 http://localhost:8765/ 2>/dev/null)
    if [ -n "$relay_status" ]; then
        echo "$relay_status" | sed 's/^/  /'
    else
        echo -e "  ${RED}Relay not responding${NC}"
    fi

    echo ""
    echo "RECENT WATCH DATA (last 10 batches):"
    grep "Batch:" /var/log/flow-detector/watch-relay.log 2>/dev/null | tail -10 | sed 's/^/  /'

    echo ""
    echo "CONNECTION EVENTS (last 5):"
    grep -E "(Watch connected|Watch disconnected|Watch heartbeat|stale)" /var/log/flow-detector/watch-relay.log 2>/dev/null | tail -5 | sed 's/^/  /'

    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "Press Ctrl+C to exit. Refreshing every 5s..."
}

# Monitor mode - continuous refresh
if [ "$1" == "-w" ] || [ "$1" == "--watch" ]; then
    while true; do
        show_status
        sleep 5
    done
else
    show_status
fi
