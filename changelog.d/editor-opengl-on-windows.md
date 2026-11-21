---
section: Added
commits:
  - feat(editor): Settings can draw WebGL through OpenGL on Windows, which compiles shaders several times faster than Direct3D 11, from the next start
---
**OpenGL on Windows, for faster shader compiles.** Settings → Renderer → **Windows graphics driver** chooses what WebGL draws through: Direct3D 11 (the default) or OpenGL. Through Direct3D every shader is translated and compiled by Microsoft's compiler, and a lit 3D material variant took 3 to 8 seconds the first time a project opened after an update; through OpenGL the same shader compiled in under a second, the editor had compiled a 3D scene's shaders in about half the time, and Play straight after opening it no longer sat at "Creating play realm" behind them (8 s down to under 1 s in a measured scene). With OpenGL there is no WebGPU, and a project set to it draws with WebGL2; some older Intel and AMD drivers draw worse through OpenGL. The choice applies when the editor restarts, and the setting says which driver the running editor has.
