/**
 * MediaPipe FaceLandmarker Initialization Module
 *
 * Provides lazy initialization of a singleton FaceLandmarker instance
 * for eye tracking. Uses CDN for model/WASM loading.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// CDN URL for MediaPipe WASM files
const MEDIAPIPE_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

// Singleton instance
let faceLandmarkerInstance: FaceLandmarker | null = null;
let initializationPromise: Promise<FaceLandmarker> | null = null;

/**
 * Configuration options for FaceLandmarker
 */
export interface FaceLandmarkerOptions {
  /** Number of faces to detect (default: 1) */
  numFaces?: number;
  /** Minimum detection confidence (default: 0.5) */
  minFaceDetectionConfidence?: number;
  /** Minimum presence confidence (default: 0.5) */
  minFacePresenceConfidence?: number;
  /** Minimum tracking confidence (default: 0.5) */
  minTrackingConfidence?: number;
  /** Output facial transformation matrices (default: false) */
  outputFaceBlendshapes?: boolean;
  /** Output facial transformation matrices (default: false) */
  outputFacialTransformationMatrixes?: boolean;
}

const DEFAULT_OPTIONS: FaceLandmarkerOptions = {
  numFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputFaceBlendshapes: false,
  outputFacialTransformationMatrixes: false,
};

/**
 * Initialize the FaceLandmarker singleton
 *
 * Uses lazy initialization - only loads when first called.
 * Subsequent calls return the same instance.
 *
 * @param options - Configuration options
 * @returns Promise resolving to the FaceLandmarker instance
 */
export async function initializeFaceLandmarker(
  options: FaceLandmarkerOptions = {}
): Promise<FaceLandmarker> {
  // Return existing instance if available
  if (faceLandmarkerInstance) {
    return faceLandmarkerInstance;
  }

  // Return existing initialization if in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start new initialization
  initializationPromise = createFaceLandmarker(options);

  try {
    faceLandmarkerInstance = await initializationPromise;
    return faceLandmarkerInstance;
  } catch (error) {
    // Reset on failure to allow retry
    initializationPromise = null;
    throw error;
  }
}

/**
 * Create a new FaceLandmarker instance
 */
async function createFaceLandmarker(
  options: FaceLandmarkerOptions
): Promise<FaceLandmarker> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Load the vision WASM module
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);

  // Create the FaceLandmarker
  const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: mergedOptions.numFaces,
    minFaceDetectionConfidence: mergedOptions.minFaceDetectionConfidence,
    minFacePresenceConfidence: mergedOptions.minFacePresenceConfidence,
    minTrackingConfidence: mergedOptions.minTrackingConfidence,
    outputFaceBlendshapes: mergedOptions.outputFaceBlendshapes,
    outputFacialTransformationMatrixes:
      mergedOptions.outputFacialTransformationMatrixes,
  });

  console.log("[FaceLandmarker] Initialized successfully");
  return faceLandmarker;
}

/**
 * Get the current FaceLandmarker instance without initializing
 *
 * @returns The current instance or null if not initialized
 */
export function getFaceLandmarker(): FaceLandmarker | null {
  return faceLandmarkerInstance;
}

/**
 * Check if FaceLandmarker is initialized
 */
export function isFaceLandmarkerInitialized(): boolean {
  return faceLandmarkerInstance !== null;
}

/**
 * Check if FaceLandmarker initialization is in progress
 */
export function isFaceLandmarkerInitializing(): boolean {
  return initializationPromise !== null && faceLandmarkerInstance === null;
}

/**
 * Dispose of the FaceLandmarker instance
 *
 * Should be called when eye tracking is no longer needed
 * to free up resources.
 */
export function disposeFaceLandmarker(): void {
  if (faceLandmarkerInstance) {
    faceLandmarkerInstance.close();
    faceLandmarkerInstance = null;
    initializationPromise = null;
    console.log("[FaceLandmarker] Disposed");
  }
}

/**
 * Process a video frame and get face landmarks
 *
 * @param video - HTMLVideoElement to process
 * @param timestamp - Current timestamp in milliseconds
 * @returns FaceLandmarkerResult or null if not initialized
 */
export function detectFaceLandmarks(
  video: HTMLVideoElement,
  timestamp: number
) {
  if (!faceLandmarkerInstance) {
    console.warn("[FaceLandmarker] Not initialized, call initializeFaceLandmarker first");
    return null;
  }

  return faceLandmarkerInstance.detectForVideo(video, timestamp);
}
