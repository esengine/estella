---
section: Fixed
commits:
  - fix(editor): project selection bounds with the displayed canvas scale
---
**Selection outlines stay aligned at fractional display scaling.** World and UI outlines use the measured canvas scale on each axis, and marquee selection uses those same displayed bounds.
