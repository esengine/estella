---
section: Fixed
commits:
  - fix(terrain): honor standalone secondary paint maps on tiled ground
---
**Tiled terrain keeps upper paint layers visible when only the second paint map exists.** Detailed chunks, distant overview pages, and ground queries now use the second map even when the first is absent.
