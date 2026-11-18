---
note: A world bigger than one server can be split into zones
commits:
  - feat(zones): zones talk over a bus - ZoneBus with MemoryBus for one process and BusHub with RemoteBus across processes, and ZoneHost sends a message to a player wherever they are, kicks them there and broadcasts to every zone, following a player who moved on and holding what arrives for one on their way in
---
