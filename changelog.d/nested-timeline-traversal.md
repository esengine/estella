---
section: Fixed
commits:
  - fix(animation): carry playback direction into nested timelines
---
**Nested timeline cues follow the intervals their parent actually played.** While a parent plays backward or wraps, nested markers, events, and particle actions fire for the crossed ranges, including across a nested clip’s own looping seam.
