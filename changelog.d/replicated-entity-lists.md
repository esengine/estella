---
section: Fixed
commits:
  - fix(net): preserve entity reference lists on spawn, state updates and reconnect
---
**Replicated components keep ordered lists of entity references on every client.** Initial spawns and subsequent updates resolve each target to its local entity, preserving repeated entries and clearing unknown targets. Reconnecting ghosts also resolve targets that appeared while the player was away. Games that replicate an entity list need both peers updated because the handshake now distinguishes lists from single references.
