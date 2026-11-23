---
section: Fixed
commits:
  - fix(assets): keep plugin types distinct across release and hot reload
---
**Plugin asset types can use namespaces safely alongside paths containing colons.** Releasing a resource by name reaches its own loader. Hot-reloading a dependency leaves handles belonging to other types available to the scene and inspector.
