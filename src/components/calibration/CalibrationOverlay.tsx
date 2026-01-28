/**
 * Calibration Overlay Component
 *
 * Full-screen overlay that guides users through the calibration process.
 * Shows step instructions, progress indicators, and visual targets.
 */

"use client";

import type { CalibrationState } from "@/lib/calibration/types";

interface CalibrationOverlayProps {
  state: CalibrationState;
  onCancel: () => void;
  onDone?: () => void;
}

export function CalibrationOverlay({ state, onCancel, onDone }: CalibrationOverlayProps) {
  const { step, progress, instruction, blinksDetected, blinksRequired } = state;

  // Don't render if not calibrating
  if (step === "idle") {
    return null;
  }

  // Show step dots only for the 4 real calibration steps (not initializing)
  const showStepIndicator = step !== "initializing";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "2rem",
      }}
    >
      {/* Cancel Button (hidden on completion — Done replaces it) */}
      {step !== "complete" && (
        <button
          onClick={onCancel}
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            padding: "0.5rem 1rem",
            backgroundColor: "transparent",
            color: "#888",
            border: "1px solid #444",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          Cancel
        </button>
      )}

      {/* Step Indicator (hidden during initializing) */}
      {showStepIndicator && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "2rem",
          }}
        >
          {["baseline", "blink", "gaze-center", "working-baseline"].map((s) => {
            const stepOrder = ["baseline", "blink", "gaze-center", "working-baseline"];
            const currentIndex = stepOrder.indexOf(step);
            const thisIndex = stepOrder.indexOf(s);
            const isComplete = step === "complete" || thisIndex < currentIndex;
            const isCurrent = step === s;

            return (
              <div
                key={s}
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  backgroundColor: isCurrent ? "#3b82f6" : isComplete ? "#22c55e" : "#444",
                  transition: "background-color 0.3s",
                }}
              />
            );
          })}
        </div>
      )}

      {/* Instruction Text */}
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: "bold",
          color: "#fff",
          textAlign: "center",
          marginBottom: "2rem",
          maxWidth: "400px",
        }}
      >
        {instruction}
      </div>

      {/* Step-specific content */}
      {step === "initializing" && (
        <div
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            backgroundColor: "#3b82f6",
            boxShadow: "0 0 20px rgba(59, 130, 246, 0.5)",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      )}

      {step === "baseline" && (
        <ProgressBar progress={progress} label="Capturing baseline..." />
      )}

      {step === "blink" && (
        <>
          <GazeTarget />
          <BlinkCounter detected={blinksDetected} required={blinksRequired} />
        </>
      )}

      {step === "gaze-center" && (
        <>
          <GazeTarget />
          <ProgressBar progress={progress} label="Capturing gaze center..." />
        </>
      )}

      {step === "working-baseline" && (
        <>
          <ReadingText />
          <ProgressBar
            progress={progress}
            label={`Capturing working baseline... ${Math.floor(progress * 30)}s / 30s`}
          />
        </>
      )}

      {step === "complete" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <div
            style={{
              fontSize: "4rem",
              color: "#22c55e",
            }}
          >
            ✓
          </div>
          <div style={{ color: "#888", fontSize: "0.875rem" }}>
            Calibration saved. You can recalibrate anytime.
          </div>
          <button
            onClick={onDone}
            style={{
              marginTop: "1rem",
              padding: "0.75rem 2rem",
              fontSize: "1rem",
              backgroundColor: "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      )}

      {/* Error display */}
      {state.error && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            backgroundColor: "rgba(239, 68, 68, 0.2)",
            borderRadius: "8px",
            color: "#ef4444",
            fontSize: "0.875rem",
          }}
        >
          {state.error}
        </div>
      )}
    </div>
  );
}

/**
 * Progress bar for timed steps
 */
function ProgressBar({ progress, label }: { progress: number; label: string }) {
  return (
    <div style={{ width: "100%", maxWidth: "300px" }}>
      <div
        style={{
          height: "8px",
          backgroundColor: "#333",
          borderRadius: "4px",
          overflow: "hidden",
          marginBottom: "0.5rem",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            backgroundColor: "#3b82f6",
            borderRadius: "4px",
            transition: "width 0.1s linear",
          }}
        />
      </div>
      <div style={{ color: "#888", fontSize: "0.875rem", textAlign: "center" }}>
        {label}
      </div>
    </div>
  );
}

/**
 * Blink counter circles
 */
function BlinkCounter({
  detected,
  required,
}: {
  detected: number;
  required: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        marginBottom: "1rem",
      }}
    >
      {Array.from({ length: required }).map((_, i) => (
        <div
          key={i}
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            backgroundColor: i < detected ? "#22c55e" : "transparent",
            border: `2px solid ${i < detected ? "#22c55e" : "#444"}`,
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "1rem",
          }}
        >
          {i < detected ? "✓" : ""}
        </div>
      ))}
    </div>
  );
}

/**
 * Center dot target for gaze calibration
 */
function GazeTarget() {
  return (
    <div
      style={{
        width: "24px",
        height: "24px",
        borderRadius: "50%",
        backgroundColor: "#3b82f6",
        boxShadow: "0 0 20px rgba(59, 130, 246, 0.5)",
        marginBottom: "2rem",
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

/**
 * Reading text for working baseline calibration
 *
 * Provides natural reading content so the user behaves normally
 * while we capture their working baseline metrics.
 */
function ReadingText() {
  return (
    <div
      style={{
        maxWidth: "600px",
        padding: "1.5rem",
        backgroundColor: "rgba(255, 255, 255, 0.05)",
        borderRadius: "12px",
        marginBottom: "2rem",
        lineHeight: 1.8,
        color: "#ccc",
        fontSize: "1rem",
        maxHeight: "300px",
        overflowY: "auto",
      }}
    >
      <p style={{ marginBottom: "1rem" }}>
        Flow state is characterized by complete absorption in an activity. When you&apos;re in flow,
        time seems to pass differently, and you feel fully engaged with what you&apos;re doing. This
        state was first described by psychologist Mihaly Csikszentmihalyi in his research on optimal
        experience and human performance.
      </p>
      <p style={{ marginBottom: "1rem" }}>
        Research shows that flow states have measurable physiological signatures. Heart rate
        variability tends to show a specific pattern—elevated but stable, reflecting engaged arousal
        without anxiety. Blink rates decrease significantly as visual attention intensifies, often
        dropping from the typical 15-20 blinks per minute to as few as 5-10 during deep focus.
      </p>
      <p style={{ marginBottom: "1rem" }}>
        Eye movement patterns also change during flow. Gaze becomes more stable and focused, with
        fewer saccades and longer fixation durations. The pupil may dilate slightly, indicating
        increased cognitive engagement. These subtle changes can be detected through careful
        measurement and compared against your personal baseline.
      </p>
      <p style={{ marginBottom: "1rem" }}>
        The challenge of flow detection lies in distinguishing genuine focused attention from
        fatigue or zoning out. Both can produce reduced blink rates, but their eye movement
        patterns differ. Flow shows purposeful, engaged gaze patterns, while fatigue produces
        more erratic or unfocused eye movements.
      </p>
      <p>
        Keep reading naturally at your normal pace. This calibration captures your typical reading
        behavior—blink frequency, eye movement patterns, and gaze stability. These measurements
        establish your personal baseline so the system can detect when you shift into deeper focus.
      </p>
    </div>
  );
}

export default CalibrationOverlay;
