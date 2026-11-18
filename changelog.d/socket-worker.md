---
section: Added
commits:
  - feat(net): startSocketWorker moves a game server's sockets onto a worker thread - the worker owns the listener and every socket, the main thread hands it each turn's frames in one message and gets clients' frames back in batches, and each connection arrives as a transport attachConnection takes unchanged
---
**A game server can keep its sockets off the simulation's thread, with `startSocketWorker`.** On a crowded replication server a third of the main thread went to writing to sockets. `startSocketWorker({ port })` (Node) runs the WebSocket listener and every socket on a worker thread: the main thread queues what it sends and hands a whole turn's frames over in one message, the worker writes each client's in one write, and clients' frames come back in batches. Each connection is an ordinary transport — `server.attachConnection(transport)`, and `transport.onClose(...)` to detach — with the same close and slow-reader handling as `webSocketTransport`. Measured with `tools/net-capacity-benchmark.mjs --worker`, the main thread's tick roughly halved, and an 800-player server kept 18 to 20 of its 20 ticks a second where it had kept about 10.
