---
section: Added
commits:
  - feat(tools): Luban builds every target a project names, each into its own folders
  - feat(settings): Luban builds a row of outputs, a client and a server each into its own folders
---
**Luban builds a client and a server from the same tables.** The project's Luban settings take a list of outputs: each names a target of `luban.conf` (`client`, `server`, …) and the folders its code and data are written to, so a game whose server reads tables the client never ships gets both from one run. Settings → Configuration tables shows them as a table with a row per output. Luban runs once per output and writes nothing until every one has worked; a project written with one target, code folder and data folder reads as that one output.
