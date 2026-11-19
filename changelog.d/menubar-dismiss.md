---
section: Fixed
commits:
  - fix(editor): an open menubar menu closes on a press anywhere that is not a menu - it listens for pointerdown in the capture phase, so the viewport cancelling the press no longer hides it, the title row's empty part counts as outside and stops being a drag region while a menu is open, and the window losing focus closes it
---
**A menu opened from the editor's menu bar now closes when you click anywhere else.** Clicking the viewport or a docked panel used to leave it open, because those areas cancel the press before the menu bar heard of it, and clicking the empty part of the title row did too, because that row is the window's drag region and the click never reached the page. The menu now closes on a press anywhere that is not a menu, and when the window loses focus; while a menu is open the title row takes clicks instead of dragging the window.
