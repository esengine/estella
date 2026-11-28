---
section: Fixed
commits:
  - fix(animation): recover incomplete and overlong active state paths
---
**Animators recover when the active path no longer points to a leaf.** A path ending at a container or continuing past a leaf is now treated as stale, so the affected layer enters its configured initial state and can resume playback.
