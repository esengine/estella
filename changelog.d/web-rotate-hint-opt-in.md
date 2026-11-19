---
section: Changed
commits:
  - feat(export): a web export covers the game with a rotate-your-device notice only when the project turns it on - packaging.platforms.web.rotateHint, off by default; off, a phone held the wrong way shows the game letterboxed, and the best-effort orientation lock and its policy hash stay
  - feat(editor): the web build asks to rotate the device only when the project turns it on - Packaging > Web gains a switch, off by default, that writes packaging.platforms.web.rotateHint only when on
---
**A web export no longer hides the game behind a "rotate your device" notice unless the project asks for it.** A phone or tablet held against the project's orientation used to see only that notice until it was turned; now it sees the game, letterboxed. A project that wants the notice turns on **Project Settings → Packaging → Web → Ask to rotate the device when held the wrong way** (`packaging.platforms.web.rotateHint`), which behaves as before. The best-effort `screen.orientation.lock` is still tried either way.
