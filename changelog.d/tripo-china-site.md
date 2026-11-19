---
note: AI agents can generate 3D models with Tripo AI.
commits:
  - feat(editor): Tripo's China site is a setting beside the international one - the two have their own accounts, keys and credits, so the AI Agents settings take a Tripo site (international tripo3d.ai or China tripo3d.com) and a key for each; requests go to the chosen site's API, a job keeps polling the site that started it if the choice changes, and a missing key says which site it is for
  - fix(editor): the China Tripo key's Chinese description ends its sentence - the line was cut off inside its string, so the editor did not compile and every check that builds it failed
---
