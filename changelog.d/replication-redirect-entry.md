---
note: A replicated game can say who a player is
commits:
  - feat(net): a replication client follows a server that sends it elsewhere and logs in again at an entry when its own is gone - authenticate can throw ReplicationRedirect, connect and every reconnect follow it with dial, entry (one address or a list tried in turn) takes over after entryAfterMs of failed redials, onStateChange reports every state as it happens, serverId names the server process, and a client that lands on another process drops the ghosts it held instead of matching that server's entities by number
---
