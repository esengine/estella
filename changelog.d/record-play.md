---
section: Added
commits:
  - "feat(editor): record the running game to a video through MCP"
  - "feat(project): ship recording the running game to a video"
---
**An AI agent can record the running game to a video through the editor's MCP tools.** `record_play` holds the game still and advances it exactly one video frame per picture, so the video plays at true speed however long the recording takes, and the same call makes the same video. It can press keys, click, tap and use a gamepad at set moments during the shot, and writes the frames and an MP4 or WebM to `renders/` in the project. The game's sound is not recorded.
