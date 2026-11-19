---
section: Added
commits:
  - feat(timeline): an audio item with a length is a clip, heard while the playhead is inside it, faded, looped and paused with the timeline
  - feat(editor): the Sequencer edits audio clips as bars with their fades, and plays and scrubs their sound
---
**Timeline sounds are clips.** An audio track's item given a length is a clip, as in Unity's Timeline and UE's Sequencer: heard only while the playhead is inside it, from a Clip In offset into the sound, faded in and out, looped to fill it if asked, paused with the timeline, joined at the right place when the playhead lands in its middle and stopped at its end; one without a length still fires the whole sound once. `AudioAPI.playClip` plays a clip from an offset and keeps its handle. In the Sequencer an audio clip is a bar with its fades drawn, its Length, Clip In, fades and loop are in the Details, and the preview plays the clips while it plays and a moment of them where the playhead is scrubbed to.
