---
section: Added
commits:
  - "feat(record): film a trailer of the running game with record_play shots"
  - "feat(camera): add TrailerDirector, shots of a camera of its own and a stand-in at the controls"
---
**A trailer of the real game can be filmed in one call.** `record_play` takes `shots`: each a few seconds of a camera
of its own flying through points (eased), looking at a place or an entity, riding along with the player if asked, at a
field of view that can change over the shot, and kept in front of walls. Meanwhile a stand-in plays through the keys a
player would press: it walks or sprints to a point, or fights the nearest enemy, attacking in reach and rolling from
its windup. The game camera, hit shakes and everything else go on as in play, and the view and keys are given back
when the recording ends. The same `TrailerDirector` is in the SDK for a game's own attract mode.
