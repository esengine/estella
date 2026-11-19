---
note: A replicated game can say who a player is
commits:
  - fix(net): a client drops the ghosts of a server it left as it applies the new server's first state - the initial batch names its server process, and the client compares it there, in order with everything else it applies, where deciding at the hello could land after that state had already been applied and wipe it
---
