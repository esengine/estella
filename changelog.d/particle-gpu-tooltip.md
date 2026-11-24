---
section: Fixed
commits:
  - fix(particles): the GPU Simulation tooltip names what stays on the CPU
---
**The GPU Simulation tooltip says what still runs on the CPU.** It said sub-emitters, trails and physics collision
were CPU-only, but GPU emitters run sub-emitters and trails; only Physics2D and Physics3D scene collision stays on the
CPU, and the tooltip now says so.
