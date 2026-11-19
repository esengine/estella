---
section: Added
commits:
  - feat(pipeline): a model's import can cut it to a triangle budget - Max Triangles in the import settings reduces every mesh by the same share, skinned ones too with their rig kept, where a generated model of 1.4 million triangles drew far more than a game needs
  - fix(editor): a Tripo model is imported at 60,000 triangles - Tripo's own topology is about 1.4 million a model, so a scene of nine drew eleven million and ran at 30 fps where it now runs at 60; the budget is the file's Max Triangles import setting, written when the model lands unless it already names one, and the .glb keeps every triangle
---
**A model's import settings take a triangle budget.** Set **Max Triangles** on a model and the import cuts it to at most that many triangles, skinned characters included, with their rigs and animations intact. The source file keeps all of them, so you can raise the number later. Models generated with the Tripo tools come in at 60,000 triangles by default, where Tripo's own 1.4 million per model made a small scene run at half speed.
