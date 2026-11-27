---
section: Fixed
commits:
  - fix(ui): route positioned wheel events to their own scroll targets
---
**Wheel gestures reach the controls where they occurred.** Scrollable UI uses each browser wheel event's position, including when the cursor moves or wheels over more than one control within a frame.
