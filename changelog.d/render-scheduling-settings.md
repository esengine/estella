---
section: Added
commits:
  - feat(editor): expose render scheduling in project settings
  - feat(render): carry project render scheduling choices into builds
---
**Project Settings now has switches for the dedicated render thread and GPU async compute.** Find both under Rendering → Render Scheduling. Local browser previews enable cross-origin isolation when the project requests a render thread. Native builds use a separate GPU compute queue on supported Metal devices.
