---
section: Changed
commits:
  - "feat(build): offer mini-game packaging options from the host feature table"
  - "feat(export): load Douyin wasm through TTWebAssembly and let it ship compressed"
---
**A Douyin export can compress its engine and move it into a subpackage, as a WeChat one can.** Compress wasm binaries and Engine in a subpackage now show on every mini-game target whose export does them, read from one table the export also acts on, instead of only on WeChat's page. On Douyin the engine loads through TTWebAssembly, which takes the compressed `.wasm.br` from base library 3.7.0.0, and the export restages files against Douyin's own published suffix list rather than WeChat's.
