---
section: Fixed
commits:
  - fix(input): route native desktop wheel events at their own positions
---
**Native desktop wheel events scroll the control under each event.** Scrolling across multiple controls between frames now uses each event's cursor position, matching Web builds and the editor's Play view.
