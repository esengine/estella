---
section: Fixed
commits:
  - fix(editor): the AI tools endpoint keeps its port across launches
---
**Connect AI Tools keeps the same address from one launch to the next.** The editor listened on a new port every time it started, so an address written into an agent's configuration stopped working. It now asks for the port it had before, and takes another only when that one is in use.
