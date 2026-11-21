---
section: Fixed
commits:
  - fix(editor): a screenshot during Play waits for the game's shaders to compile, so its first frames are not taken without them
---
**A screenshot taken during Play waits for the game's shaders.** The running game compiles its shaders in the background and leaves a draw out until its shader is ready; on the first Play after the editor opens that takes a moment longer, behind the editor's own. A screenshot taken then (by an AI agent over MCP, or an editor check) showed the scene with its water or other materials missing. The editor now counts the game's shaders still compiling as work in hand, so a screenshot waits for them as it already did for the viewport's.
