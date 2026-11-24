---
section: Changed
commits:
  - docs: rewrite the Gameplay, Scripting, Core Concepts, Assets, Performance, Publishing and Extending chapters as reference pages
---
**The remaining documentation chapters are rewritten as reference pages, in English and Chinese.** Gameplay (2D and 3D
physics, navigation, AI), Scripting (input, networking), Core Concepts (screen, app lifecycle), Assets (models, audio,
memory), Performance (profiling, quality levels), Publishing (package size, playable ads, web portals, native code,
OpenPaaS) and Extending (contribution points, project native modules) are split into sub-chapters where a page covered
several topics; old addresses redirect to the new pages. Fields are listed with their types and defaults, and
statements were checked against the code and corrected where they had drifted — among them the 3D collider and
character defaults, implicit static 3D colliders, hierarchy writes and sibling order, the headless app's plugins, the
build dialog's compression options, where target settings live, desktop runtime templates, quality-level defaults and
the number of built-in primitives.
