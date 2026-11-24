---
section: Fixed
commits:
  - fix(assets): mount lazy packages before reading their files
---
**Scenes can use assets from a lazy subpackage on first load.** Sprites, meshes, animation pages and media now wait for their files when opened directly. Concurrent loads share one mount, and a refused package can be retried immediately. In editor Play, loading a scene asset again by label or group reuses its handle. Hot updates verify files in their destination package before switching the running game to the new manifest.
