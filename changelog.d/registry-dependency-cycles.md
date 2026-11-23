---
section: Fixed
commits:
  - fix(assets): track nested registry acquisitions by their owning slot
---
**Concurrent timeline loads keep each preview's nested clips available until their last owner releases them.** Recursive script graph calls report the circular dependency. A hot edit that would make two published assets hold one another leaves the last working version in use.
