---
section: Fixed
commits:
  - fix(editor): distinguish asset choices and filter animation fields by runtime
  - fix(assets): share scene handle and reference rules with the editor
---
**The inspector shows which asset you are choosing, even when files share a name.** Long filenames wrap in the list and thumbnail views. Both views show the folder for same-named files. DragonBones and Spine fields offer the skeletons and atlases their runtime can load, including Spine skeletons saved as plain JSON. Animation controllers, avatars and media clips keep their references through an edit or undo, and clearing them gives the preview and exported scene the same empty value.
