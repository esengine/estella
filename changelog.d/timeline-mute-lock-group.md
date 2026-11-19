---
section: Added
commits:
  - feat(timeline): a track's mute, lock and group are saved with the timeline, and a muted track or channel plays nowhere
  - feat(editor): Sequencer tracks are muted, locked, filed in folders and renamed from their rows
---
**Timeline tracks are muted, locked and grouped as in Unity and UE.** A track's mute and lock and the folder it sits in are saved with the `.estimeline`; a muted track or property channel is left out wherever the timeline plays (the game, an Animator state, a nested sequence, the Sequencer preview), where before the mute was the editor's preview alone and was lost on closing it. A locked track turns every edit away until unlocked. In the Sequencer each track row has mute and lock buttons, its menu moves it into a folder (Unity's Track Groups), and a folder or a track is renamed by double-clicking its name.
