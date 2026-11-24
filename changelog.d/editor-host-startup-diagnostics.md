---
section: Fixed
commits:
  - fix(editor): drain startup diagnostics before rejecting host calls
  - fix(editor): report complete host startup errors
---
**Editor automation reports the reason a host failed to start.** The waiting call receives the final error output, including messages delivered after the host exits, and the session can start another host on the next call.
