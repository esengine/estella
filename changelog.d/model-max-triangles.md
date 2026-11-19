---
section: Added
commits:
  - feat(pipeline): a model's import can cut it to a triangle budget - Max Triangles in the import settings reduces every mesh by the same share, skinned ones too with their rig kept, where a generated model of 1.4 million triangles drew far more than a game needs
  - fix(editor): a Tripo model is imported at 60,000 triangles - Tripo's own topology is about 1.4 million a model, so a scene of nine drew eleven million and ran at 30 fps where it now runs at 60; the budget is the file's Max Triangles import setting, written when the model lands unless it already names one, and the .glb keeps every triangle
  - fix(editor): a Tripo model keeps every triangle unless a budget is asked for - importing each at 60,000 took detail a hero model or a bake source needs without being asked; tripo_generate and tripo_process take max_triangles for the import to cut to, and a model's answer says how many triangles it has and, past 200,000, what that costs and how to draw fewer
  - fix(editor): the Tripo job, landing and test files are back, with the opt-in triangle budget they were meant to carry - the commit before this one removed all three, its patch having been made in a checkout that does not track them
---
**A model's import settings take a triangle budget.** Set **Max Triangles** on a model and the import cuts it to at most that many triangles, skinned characters included, with their rigs and animations intact. The source file keeps all of them, so you can raise the number later. Tripo's own models run to about 1.4 million triangles each, enough for nine of them to halve a frame rate; they keep every triangle unless the agent asks for a budget with `max_triangles`, and each answer says how many triangles the model has.
