---
section: Fixed
commits:
  - fix(editor): show live next-draw chances for sound events
  - fix(audio): group sound event variants by resolved clip identity
---
**Sound events recognize alternate references to the same clip when avoiding repeats.** Path and UUID entries combine their weights on the first enabled row. The editor shows each clip’s chance on the next preview trigger, including after a dominant clip plays, and marks the next authored row in sequence mode.
