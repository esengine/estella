---
section: Changed
commits:
  - perf(animation): reuse native sprite and transform projection buffers
---
**Native timelines and animation controllers spend less time reading sprites and transforms.** Each world reuses a small buffer for each component type while sampling and mixing animation layers. Existing projects and older native hosts keep the same component values.
