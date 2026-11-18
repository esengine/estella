---
section: Fixed
commits:
  - fix(net): GameSocket and MiniGameSocket let go of a link the moment close() is called - the closing handshake still goes out, but close is emitted at once and the socket can connect again, where a peer that had stopped answering held both back until the host gave up
---
**Closing a socket to a server that stopped answering no longer hangs.** `GameSocket.close()` (and the mini-game sockets') started the closing handshake and then waited for the other side to answer it before saying the socket was closed and letting it connect again. A server that had stopped answering — a half-open link, which is usually why a link is being closed — never did, so a redial waited until the platform gave up. The socket now lets go at once: `close` is emitted, and `connect()` works straight away.
