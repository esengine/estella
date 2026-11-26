---
section: Fixed
commits:
  - fix(render): keep light pulses finite on long-running clocks
---
**Pulsing and flickering lights keep a finite brightness during long sessions.** The shared light calculation preserves the sine phase and safely wraps large flicker coordinates.
