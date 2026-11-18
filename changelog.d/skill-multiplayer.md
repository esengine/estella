---
section: Added
commits:
  - docs(skills): estella-multiplayer teaches an agent how an Estella game goes online - the one rule both ends run, player identity and reconnect, what to turn on when a crowd is too much and in what order, persistence and zones, and how to prove it in a multiplayer preview
---
**An agent working through the editor's MCP now has a multiplayer skill.** `skill_guide { skill: "estella-multiplayer" }` explains how to take an Estella game online: start from the `online-3d` template, keep the movement rules in one function both ends run, give players an identity so they can reconnect, and import everything networked from `esengine/replication`, `esengine/persist`, `esengine/zones` and `esengine/metrics`. It lists what to turn on when a crowd is too much, cheapest first: interest radius, interest refresh, bandwidth budget, quantized fields (declared on both ends at startup), then sockets on a worker thread. It also covers what to save, how to split a world across processes, and how to read each player's realm in a multiplayer preview.
