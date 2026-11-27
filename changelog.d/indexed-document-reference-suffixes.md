---
section: Fixed
commits:
  - fix(assets): resolve indexed document references with URL suffixes
---
**Document-relative material and tileset references can resolve local assets with query or fragment suffixes.** The dependency scan, cook, and runtime use the indexed filename for matching assets, while external URLs retain their suffixes.
