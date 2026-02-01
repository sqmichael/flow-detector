# Competitive Research Notes

## Rize (2025-02-01)

Focus tracking app with interesting UX patterns:

- **Background monitoring** — Tracks active app/window passively
- **Unobtrusive top bar** — Minimal UI that doesn't interrupt flow
- **Shortcuts** — Quick actions without context switching
- **Ground truth collection** — After categorizing activities, prompts user to rate "how focused do you feel?" to build labeled dataset

### Key Insight

Rize correlates app-based activity detection with self-reported focus levels. This creates a feedback loop for improving their detection algorithm.

### Comparison to Flow Detector

| Approach | Rize | Flow Detector |
|----------|------|---------------|
| Input signals | App/window activity | Biometrics (HR, HRV, EDA, gaze, stillness) |
| Hardware required | None | Galaxy Watch + webcam |
| Ground truth | Focus rating prompts | Intervention rating buttons |
| UI presence | Top bar | Invisible (ambient) |

### Ideas to Consider

- Proactive focus rating prompts (like Rize) vs reactive intervention ratings (current approach)
- Could combine: use biometrics for detection, prompt for ground truth periodically
