---
note: AI agents can rig, animate, retexture and reduce models with Tripo AI, and make pictures with it.
commits:
  - fix(editor): a finished Tripo job is kept after its notice closes, so asking for it again answers its result - the window's dismissal deleted it, and tripo_task then took the task up as a new job, downloaded it again and, taking it for a model, wrote an OBJ conversion's zip over the model it was converted from; a task taken up by id now lands as its type says, only glTF, GLB and FBX are imported, and nothing that is not a model is ever written under a model's name
---
