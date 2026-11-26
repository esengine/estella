---
section: Fixed
commits:
  - fix(material): resolve inspector references like the loader
  - fix(material): align runtime lookups with the cooked asset index
---
**Material previews and builds resolve the same files.** The editor recognizes project paths and UUIDs in the shader picker, and loose material loads honor the cook's sibling-first lookup for legacy names.
