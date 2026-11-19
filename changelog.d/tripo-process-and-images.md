---
section: Added
commits:
  - feat(editor): agents use the rest of Tripo - tripo_process retextures, reduces, unwraps, splits and completes, rig-checks, rigs, animates and converts a model (one Tripo made is named by its task, kept in its .meta; any other is uploaded), tripo_image draws pictures from words or other pictures and the four views of a thing, and tripo_generate takes those views and the P series; each runs as an editor job under the one notice, which says what it is doing and what a rig check found
---
**AI agents can rig, animate, retexture and reduce models with Tripo AI, and make pictures with it.** Beyond generating models, the `tripo` tools now work on a model already in the project: repaint it, cut it down to a game's face count, unwrap its UVs, split it into parts, check whether it can be rigged, rig it, put preset animations such as walk, run and jump on it, or convert it to another format. They also draw concept pictures and the four sides of a thing, which make a closer model than one picture. Each runs in the background with the same progress notice as a generation, and each tool says what it costs in credits.
