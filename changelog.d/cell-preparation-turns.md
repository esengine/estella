---
section: Changed
commits:
  - perf(residency): a streamed cell's preparation takes its pieces in a frame's turns - parsing its document, expanding its prefabs, resolving its assets and readying its programs wait for Bakes.turn instead of running whenever a fetch answers, and an urgent or rushed cell passes at once
---
**A streamed cell's preparation runs inside the frame's budget.** What runs when a cell's document and assets come back from
the network (parsing the document, expanding its prefabs, resolving its assets, readying its programs) used to run the moment
each answer came, so several cells answering together made one long frame. Each piece now waits for a turn in a frame
(`Bakes.turn`, as many a frame as the budget's remainder fits); a cell a player is upon, or one rushed because the world is
being cleared, waits for none. Decoding a mesh or texture is not split yet.
