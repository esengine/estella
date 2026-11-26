---
section: Fixed
commits:
  - fix(render): preserve composite placement through deep hierarchies
---
**Composite batching preserves placement in deep hierarchies.** Instanced sets and merged chunks follow the complete path back to the batch root, including when it passes through groups without a Transform.
