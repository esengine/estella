---
section: Fixed
commits:
  - fix(scene): share asset progress across authored and packaged loads
---
**Loading screens receive asset counts in authored and packaged scenes.** Callers joining the same scene load receive the latest count and subsequent updates. A previously prepared scene reports what it has already loaded. Packaged scenes count participating Spine and DragonBones skeleton/atlas pairs alongside sprites, meshes and other assets. Cancelling a scene stops its progress notifications.
