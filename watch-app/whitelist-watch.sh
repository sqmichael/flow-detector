#!/bin/bash
# Whitelist FlowDetector watch app to prevent Samsung Freecessor from freezing it
# Run this after installing the app or after watch reboot

PACKAGE="com.flowdetector.watch"

echo "Whitelisting $PACKAGE..."

adb shell dumpsys deviceidle whitelist +$PACKAGE
adb shell cmd appops set $PACKAGE RUN_IN_BACKGROUND allow
adb shell cmd appops set $PACKAGE RUN_ANY_IN_BACKGROUND allow

echo ""
echo "Done. Now tap Connect on your watch."
echo ""
echo "To verify:"
echo "  adb shell dumpsys deviceidle whitelist | grep flowdetector"
