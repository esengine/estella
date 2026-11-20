---
section: Fixed
commits:
  - fix(editor): the viewport compresses textures only when the Build dialog's box is ticked
---
**The editor draws textures compressed only when the build will compress them.** Since texture compression became a Build dialog box that is off until ticked, a build ships each texture as its image unless it is ticked, but the editor still compressed every texture a mesh draws to KTX2 and drew that. The viewport then showed something the package did not hold, and needed the Basis transcoder to show a project's plain PNGs at all: where it was missing, a material's preview and a mesh's textures came out black. The viewport now follows the box: as images while it is clear, compressed once it is ticked, and ticking or clearing it reloads the textures in place.
