---
internal: The engine's test runner turns its event loop between tests; nothing a project can call or draw changes.
commits:
  - fix(tests): the engine suite lets a worker read its replies between tests - a file of synchronous tests that ran past a minute, as modeling-displace does on a loaded runner, held a status update in flight the whole time, so the worker's own 60 s RPC timeout fired before the reply could be read and the file's results were lost
---
