---
section: Added
commits:
  - feat(net): a replication server and its clients exchange messages of the game's own types beside the state - server.message, broadcastMessage and onMessage, client.message and onMessage, heard only from connections that said hello and under the connection limits
---
**A replicated game can send its own messages between server and client, beside the state.** Chat, a notice, a request the replicated state does not carry: `server.message(id, 'notice', data)` and `server.broadcastMessage(type, data, filter?)` reach clients, which hear them with `client.onMessage(type, handler)` as they arrive, and `client.message(type, data)` reaches `server.onMessage(type, (connectionId, data) => …)`. The server hears only connections that have said hello, under the same frame and rate limits as everything else; types starting `repl:` are the protocol's.
