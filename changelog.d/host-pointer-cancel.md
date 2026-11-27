---
section: Fixed
commits:
  - fix(input): cancel host pointers without dispatching a release
---
**Losing focus or cancelling a touch no longer clicks a held game UI control.** Web, native, and minigame input clear cancelled buttons and pending edges without routing them as releases.
