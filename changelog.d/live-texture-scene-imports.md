---
section: Fixed
commits:
  - fix(assets): resolve live texture assignments with their owning scene
---
**Runtime texture assignments use the entity's scene settings.** Giving a sprite or mesh renderer an image path or UUID now preserves its scene's filtering, wrapping and mipmaps when another scene is also loaded. An in-flight assignment keeps the settings it started with. Subsequent edits follow a transferred entity into its new scene, and persistent entities keep their settings when their scene unloads.
