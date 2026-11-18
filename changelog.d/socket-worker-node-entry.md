---
note: A game server can keep its sockets off the simulation's thread
commits:
  - refactor(net): startSocketWorker is exported from esengine/node, not esengine/replication - it loads node:worker_threads, and the editor's renderer, which hands esengine/replication to plugins whole, carried that load into a browser chunk
---
