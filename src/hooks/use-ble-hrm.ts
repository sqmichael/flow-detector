/**
 * BLE Heart Rate Monitor Hook
 *
 * Connects to a BLE Heart Rate Monitor (standard Heart Rate Service 0x180D)
 * via Web Bluetooth API. Parses heart rate and RR-interval data from the
 * Heart Rate Measurement characteristic (0x2A37), feeding RR intervals
 * into HRVCalculator for RMSSD/SDNN computation.
 *
 * Tested with: Decathlon HRM armband (optical PPG, upper-arm)
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { HRVCalculator } from "@/lib/biometrics/hrv-calculator";
import type { HRVMetrics } from "@/lib/biometrics/types";

export interface BleHrmState {
  isConnected: boolean;
  isConnecting: boolean;
  deviceName: string | null;
  heartRate: number | null;
  latestIBI: number | null;
  hrvMetrics: HRVMetrics | null;
  error: string | null;
}

export interface UseBleHrmReturn extends BleHrmState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Parse a Heart Rate Measurement characteristic value (0x2A37)
 * per Bluetooth SIG specification.
 *
 * A single notification may contain multiple RR intervals.
 */
export function parseHeartRateMeasurement(dataView: DataView): {
  heartRate: number;
  rrIntervals: number[];
} {
  const flags = dataView.getUint8(0);
  const is16BitHR = (flags & 0x01) !== 0;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRRInterval = (flags & 0x10) !== 0;

  let offset = 1;

  // Parse heart rate value
  let heartRate: number;
  if (is16BitHR) {
    heartRate = dataView.getUint16(offset, true);
    offset += 2;
  } else {
    heartRate = dataView.getUint8(offset);
    offset += 1;
  }

  // Skip energy expended field if present
  if (hasEnergyExpended) {
    offset += 2;
  }

  // Parse RR intervals (uint16, units of 1/1024 seconds)
  const rrIntervals: number[] = [];
  if (hasRRInterval) {
    while (offset + 1 < dataView.byteLength) {
      const rawRR = dataView.getUint16(offset, true);
      const rrMs = (rawRR / 1024) * 1000;
      rrIntervals.push(rrMs);
      offset += 2;
    }
  }

  return { heartRate, rrIntervals };
}

const HEART_RATE_SERVICE = "heart_rate";
const HEART_RATE_MEASUREMENT = "heart_rate_measurement";

export function useBleHrm(): UseBleHrmReturn {
  const [state, setState] = useState<BleHrmState>({
    isConnected: false,
    isConnecting: false,
    deviceName: null,
    heartRate: null,
    latestIBI: null,
    hrvMetrics: null,
    error: null,
  });

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const hrvCalculatorRef = useRef<HRVCalculator>(new HRVCalculator());

  // Handle BLE notifications
  const handleNotification = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const dataView = characteristic.value;
    if (!dataView) return;

    const { heartRate, rrIntervals } = parseHeartRateMeasurement(dataView);
    const timestamp = Date.now();

    // Feed each RR interval into HRV calculator
    let latestIBI: number | null = null;
    for (const rr of rrIntervals) {
      hrvCalculatorRef.current.addIBI(rr, timestamp);
      latestIBI = rr;
    }

    // Calculate HRV metrics (returns null if insufficient samples)
    const hrvMetrics = hrvCalculatorRef.current.calculate();

    setState((prev) => ({
      ...prev,
      heartRate,
      latestIBI: latestIBI ?? prev.latestIBI,
      hrvMetrics: hrvMetrics ?? prev.hrvMetrics,
    }));
  }, []);

  // Handle unexpected disconnection
  const handleDisconnect = useCallback(() => {
    console.log("[BLE HRM] Device disconnected");
    characteristicRef.current = null;

    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      error: "HRM disconnected",
    }));
  }, []);

  const connect = useCallback(async () => {
    // Check Web Bluetooth support
    if (!navigator.bluetooth) {
      setState((prev) => ({
        ...prev,
        error: "Web Bluetooth is not supported in this browser. Use Chrome on desktop.",
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
    }));

    try {
      // Request device — triggers browser picker (requires user gesture)
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
      });

      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", handleDisconnect);

      setState((prev) => ({
        ...prev,
        deviceName: device.name ?? "Unknown HRM",
      }));

      // Connect to GATT server
      const server = await device.gatt!.connect();

      // Get Heart Rate Service
      const service = await server.getPrimaryService(HEART_RATE_SERVICE);

      // Get Heart Rate Measurement characteristic
      const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
      characteristicRef.current = characteristic;

      // Subscribe to notifications
      characteristic.addEventListener("characteristicvaluechanged", handleNotification);
      await characteristic.startNotifications();

      // Reset HRV calculator for fresh session
      hrvCalculatorRef.current.reset();

      setState((prev) => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        heartRate: null,
        latestIBI: null,
        hrvMetrics: null,
        error: null,
      }));

      console.log("[BLE HRM] Connected to", device.name);
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotFoundError"
          ? "No HRM device selected"
          : err instanceof Error
            ? err.message
            : "Failed to connect";

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: message,
      }));
    }
  }, [handleNotification, handleDisconnect]);

  const disconnect = useCallback(() => {
    if (characteristicRef.current) {
      try {
        characteristicRef.current.removeEventListener(
          "characteristicvaluechanged",
          handleNotification
        );
        characteristicRef.current.stopNotifications().catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
      characteristicRef.current = null;
    }

    if (deviceRef.current) {
      deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnect);
      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
      deviceRef.current = null;
    }

    hrvCalculatorRef.current.reset();

    setState({
      isConnected: false,
      isConnecting: false,
      deviceName: null,
      heartRate: null,
      latestIBI: null,
      hrvMetrics: null,
      error: null,
    });

    console.log("[BLE HRM] Disconnected");
  }, [handleNotification, handleDisconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (characteristicRef.current) {
        try {
          characteristicRef.current.stopNotifications().catch(() => {});
        } catch {
          // Ignore
        }
      }
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
    };
  }, []);

  return {
    ...state,
    connect,
    disconnect,
  };
}
