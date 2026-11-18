---
section: Added
commits:
  - feat(residency): a streamed cell arrives and leaves over frames under the frame's budget - its roots stay switched off until it is whole, at most four cells prepare and one publishes at a time, and a cell a source is upon is finished at once and, under the default slowStreaming 'wait', holds the game until it is in, as Unreal's level streaming does
---
**A streamed world's cells arrive and leave within the frame's budget, with Unreal's streaming policy.** A large cell used to be
spawned in the frame it was published, which was a hitch. Now its entities are spawned a piece at a time under `Bakes.budgetMs`,
with its roots switched off until the last piece so nothing sees it half arrived, and a cell let go is hidden at once and destroyed
over frames. `streamer.setPolicy()` sets how much streams at once and what happens when the world falls behind, with Unreal's
defaults: four cells prepared at once, one published at a time, a cell urgent within a quarter of a source's `loadRadius`, and
`slowStreaming: 'wait'` holding the game until an urgent cell is in (`'publish'` finishes it without holding, `'budget'` never
goes past the budget). `worldResidencyReport` reports urgent and queued cells, holds and rushed publications.
