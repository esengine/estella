---
section: Fixed
commits:
  - "fix(timeline): give back the camera when playback ends or detaches"
---
**Timeline gives back the view when its camera shot stops.** Pausing keeps the shot. Stopping, losing the timeline asset, removing the player component or unloading the plugin releases it. A marker that stops or removes its own player cannot restore the shot later in the same frame.
