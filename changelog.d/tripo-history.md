---
note: AI agents can rig, animate, retexture and reduce models with Tripo AI, and make pictures with it.
commits:
  - feat(editor): agents look in Tripo's history before paying for something again - tripo_history lists every job of the project with what was asked, where it landed and what it cost, the models it holds from Tripo, and with remote_days what the account made anywhere; finished jobs are kept as history across sessions, every running job is asked about in one request, a picture or model can be smart-segmented and a picture made into a Gaussian splat; and the progress display no longer flickers: digits keep one width so the notice does not shift each second, and importing keeps a full bar instead of emptying into a sweep
---
