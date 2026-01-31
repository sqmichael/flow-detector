/**
 * Ambient Agent Module
 *
 * A sensor-triggered intervention system that tests whether biometric
 * context (HR/HRV) makes interventions feel better-timed than fixed schedules.
 *
 * Usage:
 *   npx tsx server/ambient-agent/cli.ts start    # Sensor-triggered mode
 *   npx tsx server/ambient-agent/cli.ts fixed    # Fixed-time control mode
 *   npx tsx server/ambient-agent/cli.ts compare  # Compare conditions
 */

export { AmbientAgent, getAgent, stopAgent } from "./agent";
export { InterventionLogger } from "./logger";
export {
  detectFlowState,
  detectStressPattern,
  shouldTriggerEveningReflection,
  estimateBaseline,
} from "./detectors";
export {
  enableFocusMode,
  disableFocusMode,
  sendWatchHaptic,
  triggerPhoneCall,
  showNotification,
  executeIntervention,
  createIntervention,
} from "./interventions";
export * from "./types";
