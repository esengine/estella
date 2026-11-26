---
section: Fixed
commits:
  - "fix(timeline): dispatch markers and custom events from nested sequences"
---
**Nested timelines deliver their custom events and markers during playback.** The event target resolves from the nested sequence's root or a player binding, and the payload still identifies the original TimelinePlayer entity. Seeking while paused leaves skipped cues undispatched.
