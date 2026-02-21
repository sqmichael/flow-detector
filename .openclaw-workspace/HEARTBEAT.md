# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.

- Every heartbeat, verify flow-detector runtime health using live context:
  - Confirm watch stream freshness (`sensors.dataAgeSec <= 90` when connected).
  - Confirm baseline readiness (`baseline != null`); if missing, say exactly why from latest disqualifier.
  - Confirm OpenClaw state (`ACTIVE` vs fallback) and report consecutive failures.
  - If any check fails, return a concise actionable status with one next step.
