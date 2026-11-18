---
section: Fixed
commits:
  - fix(export): a playable packs atlases, each page inlined once, and its sprites draw their own frame - the playable export never passed atlas packing to its cook, and had no way to tell its runtime where a frame sits on its page, so it shipped every sprite separately and a packed one would have drawn the whole page; the page now rides once under its first frame, every other frame points at it, and a catalog of frame positions reaches the runtime as it does in a web build
  - feat(build): a playable's Build dialog offers atlas packing - the playable export now carries each page once and every frame's place on it, so the box the dialog hid from playables is shown there too
---
**Playables can pack atlases.** Ticking *Pack atlases* for a playable packs each `<name>.atlas/` folder into pages as other targets do. Each page is carried in the HTML once, however many sprites are on it, and the page tells its runtime where each frame sits, so every sprite draws its own frame. Before this, the playable export never packed atlases at all, and the runtime had nothing to say where a frame was, so the option was hidden for playables.
