---
section: Fixed
commits:
  - fix(picking): honor the far plane of presented camera rays
---
**Click selection follows the camera’s depth range.** Edit and Play picking skip objects fully beyond the camera’s far plane, and clicks still reach visible geometry when a very distant far plane projects to infinity.
