---
note: A world bigger than one server can be split into zones
commits:
  - feat(zones): any zone takes a login and sends the player where they belong - a player online elsewhere is sent to that zone, which replaces the older connection, one held by a zone that stopped heartbeating is taken over without waiting out the lease, and a route hook (default - back where they logged out, else a live line of the same kind, else home) picks the zone; a player sent back to the zone they just left is taken in at once
---
