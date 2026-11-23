---
section: Fixed
commits:
  - fix(water): waves, waterfalls and rain rings take the project's gravity and units, as its physics does
  - fix(editor): the editor's waves and waterfalls take the project's gravity, as its physics does
---
**Water falls as the project's physics falls.** The waves' speed (how fast a wave of a given length travels) and a waterfall's path
used a gravity of their own, 9.8 m/s², while the project's 3D physics takes the gravity set in Project Settings (9.81 by default): a
project with a different gravity had boats bobbing to one pull and waves travelling by another. Both now take the project's gravity,
in Play, in a build and in the editor. Rain rings on water are sized from the project's units a metre rather than from the gravity.
