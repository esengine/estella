---
note: A game server can keep what it holds across restarts
commits:
  - fix(persist): FileStore retries a rename Windows refuses for a moment - replacing a file another handle has open (a reader, an indexer, a virus scanner) failed with EPERM, EBUSY or EACCES and lost the write; it is retried briefly and the temporary file is removed if it never goes through
---
