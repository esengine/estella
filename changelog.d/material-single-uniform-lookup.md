---
section: Changed
commits:
  - perf(material): read individual uniforms directly through instance chains
---
**Reading one material parameter is faster on inherited materials.** The runtime looks up just that parameter, preserving the closest override and the existing fallback behavior.
