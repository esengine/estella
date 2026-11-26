---
section: Added
commits:
  - feat(editor): a VR switch in Project Settings, and Enter VR in Play
---
**VR is switched on in Project Settings, and Play offers Enter VR.** Project Settings > Rendering has a VR headsets (WebXR)
switch, so `features.rendering.vr` no longer has to be written by hand, and agents can set it too. With it on, Play shows the
same Enter VR button a shipped page does, in the Game panel, wherever the editor itself can present to a headset; it stays
hidden where it cannot. The browser preview on the computer the headset is connected to is the dependable way to try it.
A headset's own browser reaches a preview only over HTTPS or localhost (`adb reverse`), and the setting's description and the
VR guide say so.
