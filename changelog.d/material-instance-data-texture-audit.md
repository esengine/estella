---
section: Fixed
commits:
  - fix(health): audit data textures through material inheritance
---
**Project Health checks data textures against the shader their material actually uses.** It follows material instances to the root shader, resolves file references with the same precedence as the runtime, and catches sRGB normal and data maps overridden in nested instances.
