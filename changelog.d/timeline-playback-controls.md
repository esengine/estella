---
section: Added
commits:
  - feat(timeline): a TimelinePlayer plays a range of its timeline, can run on real time, and sends played, paused, stopped, finished and looped events
  - test(editor): an editor check plays a ranged loop, a real-time player under a paused game and the playback events in play
---
**A timeline player is controlled like Unity's and UE's.** A `TimelinePlayer` can play a range of its timeline (`rangeStart` to `rangeEnd`, as UE's playback range): it starts at the range's start, finishes at its end or loops within it. `unscaledTime` runs it on real time, so it plays on while the game is paused with `Time.scale` 0. What it does is sent as a `TimelinePlayback` event: `played`, `paused`, `stopped` (rewound), `finished` and `looped`, as Unity's PlayableDirector events and UE's OnPlay, OnPause, OnStop and OnFinished are.
