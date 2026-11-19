---
note: A world bigger than one server can be split into zones
commits:
  - feat(zones): a zone can be taken down without dropping anyone - drain marks it so no pick, route or transfer sends anyone there and a login is sent on, transfers every player it holds where the route says with reason drain, kicks at a deadline only those with nowhere to go, then stops
---
