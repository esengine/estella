---
section: Fixed
commits:
  - fix(render): a texture streaming shrank goes back to full size once the quality level stops streaming - a level with textureStreaming off returned before the streamer did anything, so what low or medium had shrunk, and what had loaded small while they streamed, stayed small at high for good; once streaming is off the streamer puts every texture held below its file back at full size, four at a time and after the moves still landing, and putting a texture back is one move shared with the textures something other than a mesh draws
  - fix(render): a texture that cannot come back at full size is asked for once, not on every pass - a put-back that decoded smaller than its file, or that the host could not do, was tried again every quarter second for as long as streaming stayed off; it now keeps the size it reached and counts as a failure
---
**Textures are sharp again after switching to a quality level that does not stream them.** Texture streaming, on at low and medium by default, holds a mesh texture at the size its views need; switching to high, which does not stream, left every texture it had shrunk, and every one that had loaded small, at that size for good. Once streaming is off, the streamer now puts them all back at full size.
