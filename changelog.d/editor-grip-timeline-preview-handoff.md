---
section: Fixed
commits:
  - "fix(editor): hand off the edit pose between timeline and grip previews"
  - "fix(editor): ship timeline and grip preview handoff"
---
**Grip and Sequencer previews hand off the edit pose cleanly.** An active grip preview pauses the Sequencer viewport preview and starts from the scene pose. Clearing the grip resumes the open timeline, and a grip clip that finishes loading after it was cleared stays cleared.
