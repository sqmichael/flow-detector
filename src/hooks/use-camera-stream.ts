/**
 * Camera Stream Hook
 *
 * Manages camera permissions and MediaStream for eye tracking.
 * Handles permission state, video element setup, and cleanup.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { CameraStreamState } from "@/lib/mediapipe/types";

/** Camera constraints for eye tracking - 720p at 30fps preferred */
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280, min: 640 },
    height: { ideal: 720, min: 480 },
    frameRate: { ideal: 30, min: 15 },
    facingMode: "user",
  },
  audio: false,
};

export interface UseCameraStreamReturn {
  /** Current state of the camera stream */
  state: CameraStreamState;
  /** Reference to attach to a video element */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Request camera permission and start stream */
  startStream: () => Promise<boolean>;
  /** Stop the stream and release resources */
  stopStream: () => void;
  /** Check if camera is available (without requesting permission) */
  checkAvailability: () => Promise<boolean>;
}

/**
 * Hook for managing camera stream for eye tracking
 *
 * @example
 * ```tsx
 * const { state, videoRef, startStream, stopStream } = useCameraStream();
 *
 * // In JSX:
 * <video ref={videoRef} autoPlay playsInline muted />
 *
 * // Start streaming:
 * await startStream();
 * ```
 */
export function useCameraStream(): UseCameraStreamReturn {
  const [state, setState] = useState<CameraStreamState>({
    stream: null,
    permissionStatus: "prompt",
    error: null,
    isLoading: false,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Check if camera is available without requesting permission
   */
  const checkAvailability = useCallback(async (): Promise<boolean> => {
    // Check if mediaDevices API is available
    if (!navigator.mediaDevices?.getUserMedia) {
      setState((prev) => ({
        ...prev,
        permissionStatus: "unavailable",
        error: "Camera API not available in this browser",
      }));
      return false;
    }

    // Try to query permission state if available
    if (navigator.permissions?.query) {
      try {
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        setState((prev) => ({
          ...prev,
          permissionStatus: result.state as CameraStreamState["permissionStatus"],
        }));
        return result.state !== "denied";
      } catch {
        // Permission query not supported, but API exists
        return true;
      }
    }

    return true;
  }, []);

  /**
   * Start the camera stream
   */
  const startStream = useCallback(async (): Promise<boolean> => {
    // Check if already streaming
    if (streamRef.current) {
      return true;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      streamRef.current = stream;

      // Attach to video element if available
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setState({
        stream,
        permissionStatus: "granted",
        error: null,
        isLoading: false,
      });

      console.log("[CameraStream] Started successfully");
      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const permissionStatus = getPermissionStatus(error);

      setState({
        stream: null,
        permissionStatus,
        error: errorMessage,
        isLoading: false,
      });

      console.error("[CameraStream] Failed to start:", errorMessage);
      return false;
    }
  }, []);

  /**
   * Stop the camera stream and release resources
   */
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setState((prev) => ({
      ...prev,
      stream: null,
      isLoading: false,
    }));

    console.log("[CameraStream] Stopped");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, []);

  // Check initial availability
  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  return {
    state,
    videoRef,
    startStream,
    stopStream,
    checkAvailability,
  };
}

/**
 * Get user-friendly error message from camera error
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "Camera permission was denied. Please allow camera access in your browser settings.";
      case "NotFoundError":
        return "No camera found. Please connect a camera and try again.";
      case "NotReadableError":
        return "Camera is in use by another application. Please close other apps using the camera.";
      case "OverconstrainedError":
        return "Camera does not support required settings. Try a different camera.";
      case "SecurityError":
        return "Camera access blocked due to security settings.";
      default:
        return `Camera error: ${error.message}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred while accessing the camera.";
}

/**
 * Determine permission status from error
 */
function getPermissionStatus(error: unknown): CameraStreamState["permissionStatus"] {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "denied";
      case "NotFoundError":
      case "NotReadableError":
        return "unavailable";
      default:
        return "prompt";
    }
  }
  return "prompt";
}

export default useCameraStream;
