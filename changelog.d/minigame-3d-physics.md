---
section: Added
commits:
  - feat(physics): build and export 3D solvers for mini-games
---
**WeChat and Douyin mini-games can run 3D physics with Jolt or PhysX.** Exports package the project's selected 3D solver and add Box2D when the game also uses 2D physics. With engine subpackaging enabled, each optional engine binary downloads on first use and stays outside the main-package budget. The exporter names the matching build command for a missing or Web-only solver. A targeted build restores missing files and syncs its selected runtime to the editor.
