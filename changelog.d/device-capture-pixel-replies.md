---
section: Fixed
commits:
  - fix(editor): validate and retire device capture pixel replies
---
**Device screenshots and frame replays reject incomplete pixel data.** The editor discards image chunks when their request expires and continues to accept new captures.
