---
section: Added
commits:
  - feat(runtime): a project can cap the frame rate its game boots with
  - feat(editor): Project Settings has a frame rate cap
---
**A project can cap its frame rate.** Project Settings → Game → Runtime → Frame has a Frame rate cap (`features.runtime.maxFrameRate`): 0, the default, follows the display as before, so a 120 or 165 Hz phone draws that many frames and heats up for it; 60 or 30 caps the exported game on web, mini-game and native hosts from the first frame. `App.setTargetFrameRate` still changes it while the game runs.
