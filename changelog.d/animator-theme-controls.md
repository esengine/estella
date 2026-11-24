---
section: Fixed
commits:
  - fix(animator): use shared controls and theme tokens
  - fix(editor): ship themed animation controller controls
---
**The animation controller editor now exposes its controls to keyboard and screen reader users consistently.** Transition choices announce their selected state, joint removal names the joint, and the parameter row reveals its remove button on keyboard focus. Graph labels and controls follow the editor’s shared type, colour and spacing settings.
