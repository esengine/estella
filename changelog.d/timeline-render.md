---
section: Added
commits:
  - feat(editor): the Sequencer renders a timeline to PNG frames and an MP4 or WebM by stepping the game a frame at a time
---
**A timeline renders to a video.** The Sequencer's Render makes the timeline into PNG frames and an MP4 or WebM, as UE's Movie Render Queue and Unity's Recorder do: it plays the timeline's player in the game, paused and stepped exactly one frame of the chosen rate (24, 30 or 60) at a time, reads each frame back from the game's canvas, writes the frames under `renders/` and encodes them with the editor's ffmpeg. A render gives the same pictures every time, whatever the machine, and leaves Play as it found it.
