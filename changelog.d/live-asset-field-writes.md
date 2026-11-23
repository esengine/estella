---
section: Fixed
commits:
  - fix(assets): honor the latest live component asset write
---
**Changing a sprite or mesh texture while it is loading now displays the last texture assigned.** Clearing the field or replacing the component also cancels the earlier assignment. Updating a mesh texture leaves an independently loading normal map intact. Superseded loads release their resources and leave the current atlas coordinates alone.
