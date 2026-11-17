---
section: Changed
commits:
  - perf(input): a web game with no gamepad does not ask the browser for its pads every frame - navigator.getGamepads() ran in every frame of every game, and nearly every game on a phone has no pad; with none known the browser is asked once a second, at once when it announces one, and every frame while one is plugged in
  - perf(ui): the focus system asks whether one control may hold focus, not for the whole Tab ring, every frame - it built and sorted every Focusable's traversal entry each frame to check the focused control and any pressed one; it now checks those two, and sorts the ring only when Tab is pressed
  - perf(camera): a camera's view is read out of the engine's memory - the two camera resolves of every frame built each camera's Camera and Transform through the registry's getters, field by field into new objects; they now read them through the world as a query does
---
**A web game with no gamepad, a UI with focusable controls and every camera cost less each frame.** A web game asked the browser for its gamepads every frame, one of the slower calls a page can make, though nearly every game on a phone has none: with no pad known it now asks about once a second, and at once when the browser announces one. The focus system built and sorted the whole Tab ring every frame to check the focused control; it now checks that one control and sorts the ring only when Tab is pressed. A camera's Camera and Transform are read out of the engine's memory, as a query reads them, instead of being built field by field twice a frame.
