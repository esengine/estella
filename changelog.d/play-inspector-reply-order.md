---
section: Fixed
commits:
  - fix(editor): keep Play inspector replies in order
---
**The Play inspector keeps the current selection when an older reply arrives late.** Stopping Play or switching inspection targets discards outstanding replies from the previous session. The hierarchy updates when an eye button becomes available, and unchanged tree replies are cheaper to compare.
