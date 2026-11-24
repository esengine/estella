---
section: Fixed
commits:
  - fix(templates): the 3D Starter ground holds a character as far as it is drawn
---
**A character in the 3D Starter no longer falls through the ground 40 m out.** The ground was drawn 400 m across while its collider was 80 m across, so a character running off in any direction dropped through ground it could see. The collider now covers all of it.
