#!/bin/bash
# Device Connection Helper Scripts for Flow Detector
# Tailscale network addresses (static)

set -e

# Device addresses
LINUX_SERVER="100.91.32.70"
MACBOOK="100.100.89.36"
ANDROID_PHONE="100.114.70.120"
ANDROID_SSH_PORT="8022"
ANDROID_USER="u0_a177"
MAC_USER="user"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  status              - Show all device connection status"
    echo "  mac [cmd]           - SSH to MacBook (optional command)"
    echo "  android [cmd]       - SSH to Android phone (optional command)"
    echo "  watch-build         - Build watch app on MacBook"
    echo "  watch-install       - Install watch APK via ADB (requires ADB connection)"
    echo "  adb-connect <port>  - Connect ADB to phone's wireless debugging"
    echo "  adb-watch <port>    - Connect ADB to watch through phone hotspot"
    echo "  relay-restart       - Restart watch relay server"
    echo ""
    echo "Examples:"
    echo "  $0 status"
    echo "  $0 mac 'ls -la'"
    echo "  $0 watch-build"
    echo "  $0 adb-connect 43991"
}

check_ssh() {
    local host=$1
    local user=$2
    local port=${3:-22}
    if ssh -o ConnectTimeout=3 -o BatchMode=yes -p "$port" "$user@$host" "echo ok" &>/dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
}

check_ping() {
    local host=$1
    if ping -c 1 -W 2 "$host" &>/dev/null; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
    fi
}

cmd_status() {
    echo "Device Status (Tailscale Network)"
    echo "=================================="
    echo -n "Linux Server ($LINUX_SERVER): "
    check_ping "$LINUX_SERVER"

    echo -n "MacBook ($MACBOOK): "
    check_ping "$MACBOOK"
    echo -n "  SSH: "
    check_ssh "$MACBOOK" "$MAC_USER"

    echo -n "Android Phone ($ANDROID_PHONE): "
    check_ping "$ANDROID_PHONE"
    echo -n "  SSH (Termux): "
    check_ssh "$ANDROID_PHONE" "$ANDROID_USER" "$ANDROID_SSH_PORT"

    echo ""
    echo "ADB Devices:"
    adb devices -l 2>/dev/null || echo "  (adb not available)"
}

cmd_mac() {
    local cmd="$*"
    if [ -z "$cmd" ]; then
        ssh -o ConnectTimeout=10 "$MAC_USER@$MACBOOK"
    else
        ssh -o ConnectTimeout=10 "$MAC_USER@$MACBOOK" "$cmd"
    fi
}

cmd_android() {
    local cmd="$*"
    if [ -z "$cmd" ]; then
        ssh -o ConnectTimeout=10 -p "$ANDROID_SSH_PORT" "$ANDROID_USER@$ANDROID_PHONE"
    else
        ssh -o ConnectTimeout=10 -p "$ANDROID_SSH_PORT" "$ANDROID_USER@$ANDROID_PHONE" "$cmd"
    fi
}

cmd_watch_build() {
    echo "Building watch app on MacBook..."
    local JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    ssh -o ConnectTimeout=10 "$MAC_USER@$MACBOOK" "
        export JAVA_HOME='$JAVA_HOME'
        export PATH=\"\$JAVA_HOME/bin:\$PATH\"
        cd ~/StudioProjects/flow-detector/watch-app
        git pull
        ./gradlew assembleDebug
    "
    echo ""
    echo -e "${GREEN}Build complete!${NC}"
    echo "APK location: ~/StudioProjects/flow-detector/watch-app/app/build/outputs/apk/debug/app-debug.apk"
}

cmd_watch_install() {
    echo "Installing watch APK..."
    local APK_PATH="app/build/outputs/apk/debug/app-debug.apk"

    # Check ADB connection
    if ! adb devices | grep -q "device$"; then
        echo -e "${RED}No ADB device connected. Use 'adb-connect' first.${NC}"
        exit 1
    fi

    # Copy APK from Mac and install
    echo "Fetching APK from MacBook..."
    scp "$MAC_USER@$MACBOOK:~/StudioProjects/flow-detector/watch-app/$APK_PATH" /tmp/watch-app.apk

    echo "Installing to device..."
    adb install -r /tmp/watch-app.apk
    echo -e "${GREEN}Installation complete!${NC}"
}

cmd_adb_connect() {
    local port=$1
    if [ -z "$port" ]; then
        echo "Usage: $0 adb-connect <port>"
        echo "Get the port from: Android Settings > Developer Options > Wireless Debugging"
        exit 1
    fi

    echo "Connecting ADB to $ANDROID_PHONE:$port..."
    adb connect "$ANDROID_PHONE:$port"
}

cmd_adb_watch() {
    local port=$1
    if [ -z "$port" ]; then
        echo "Usage: $0 adb-watch <port>"
        echo "Get the port from watch's wireless debugging settings"
        echo "Note: Watch must be on phone's hotspot network"
        exit 1
    fi

    # Watch is typically on phone's hotspot, get its IP
    echo "Connecting ADB to watch on phone hotspot..."
    echo "Note: Ensure watch is connected to phone's hotspot"
    adb connect "10.100.65.178:$port"
}

cmd_relay_restart() {
    echo "Restarting watch relay server..."
    pkill -f "watch-relay" || true
    sleep 1
    cd /root/flow-detector
    npm run watch-server -- --verbose > /tmp/watch-relay-verbose.log 2>&1 &
    sleep 2
    echo -e "${GREEN}Relay restarted!${NC}"
    tail -10 /tmp/watch-relay-verbose.log
}

# Main
case "${1:-}" in
    status)
        cmd_status
        ;;
    mac)
        shift
        cmd_mac "$@"
        ;;
    android)
        shift
        cmd_android "$@"
        ;;
    watch-build)
        cmd_watch_build
        ;;
    watch-install)
        cmd_watch_install
        ;;
    adb-connect)
        cmd_adb_connect "$2"
        ;;
    adb-watch)
        cmd_adb_watch "$2"
        ;;
    relay-restart)
        cmd_relay_restart
        ;;
    *)
        usage
        exit 1
        ;;
esac
