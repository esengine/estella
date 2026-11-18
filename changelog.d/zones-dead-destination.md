---
note: A world bigger than one server can be split into zones
commits:
  - feat(zones): a player sent to a zone that has just died comes back by itself - zones heartbeat every second and a transfer goes only to one heard from within three heartbeats, the handed-over lease lasts only arrivalLeaseMs until the destination takes it up, and the transfer names the zone left as a fallback the client logs in to again when the destination cannot be reached
---
