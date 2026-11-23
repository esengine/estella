---
section: Fixed
commits:
  - fix(timeline): release pooled poses with their world and preview binding
---
**Closing a world or rebinding its timeline preview releases cached animation data.** Each world reuses its own pose buffers while a timeline plays. A preview or game that closes can now release the component data those buffers held.
