---
section: Fixed
commits:
  - fix(editor): keep Alt-drag copies in the grabbed parallax frame
---
**Alt-dragged copies keep the pivot you grabbed.** If the camera moves between grabbing a rotation or scale handle and creating the copies, the gesture uses the same parallax offsets for the copies and the pivot.
