/**
 * Post-flow confirmation banner.
 *
 * Appears when the algorithm detects a sustained flow block has ended.
 * Shows the detected time range and 4 buttons for the user to label
 * their subjective experience. Auto-dismisses after 30 seconds.
 */

"use client";

import { useEffect, useState } from "react";

interface FlowEndPromptProps {
  startTime: number;
  endTime: number;
  onLabel: (label: "high" | "mid" | "low" | "wrong") => void;
  onDismiss: () => void;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(startMs: number, endMs: number): string {
  const mins = Math.round((endMs - startMs) / 60000);
  if (mins < 1) return "< 1 min";
  if (mins === 1) return "1 min";
  return `${mins} min`;
}

export default function FlowEndPrompt({
  startTime,
  endTime,
  onLabel,
  onDismiss,
}: FlowEndPromptProps) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 30 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, 30000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!visible) return null;

  const handleLabel = (label: "high" | "mid" | "low" | "wrong") => {
    onLabel(label);
    setVisible(false);
  };

  const buttons: { label: "high" | "mid" | "low" | "wrong"; text: string; color: string }[] = [
    { label: "high", text: "High", color: "#22c55e" },
    { label: "mid", text: "Mid", color: "#f59e0b" },
    { label: "low", text: "Low", color: "#ef4444" },
    { label: "wrong", text: "Wrong", color: "#6b7280" },
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        backgroundColor: "rgba(30, 30, 40, 0.95)",
        border: "1px solid rgba(100, 100, 120, 0.4)",
        borderRadius: "12px",
        padding: "1rem 1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(8px)",
        animation: "slideDown 0.3s ease-out",
      }}
    >
      <div style={{ color: "#ccc", fontSize: "0.9rem", whiteSpace: "nowrap" }}>
        Focus block: {formatTime(startTime)} – {formatTime(endTime)}{" "}
        <span style={{ color: "#888" }}>({formatDuration(startTime, endTime)})</span>
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        {buttons.map((b) => (
          <button
            key={b.label}
            onClick={() => handleLabel(b.label)}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              border: `1px solid ${b.color}`,
              backgroundColor: "transparent",
              color: b.color,
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 500,
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = `${b.color}22`;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = "transparent";
            }}
          >
            {b.text}
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
        style={{
          background: "none",
          border: "none",
          color: "#666",
          cursor: "pointer",
          fontSize: "1.2rem",
          padding: "0 0.25rem",
          lineHeight: 1,
        }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
