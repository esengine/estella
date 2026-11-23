---
section: Fixed
commits:
  - fix(aot): synchronize the engine digest with LODMember
---
**Native games can load precompiled systems built for the engine that introduced LODMember.** The host and compiler now include the component's layout in the same interface digest.
