---
section: Fixed
commits:
  - fix(timeline): release pooled poses with their world and preview binding
---
**Closing a world or rebinding its timeline preview releases cached animation data.** Each world reuses its own pose buffers while a timeline plays. Scenes playing side by side keep their script fields independent even when their entity IDs match.
