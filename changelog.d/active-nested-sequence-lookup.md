---
section: Changed
commits:
  - perf(timeline): skip asset lookups for inactive sequence clips
---
**Long timelines do less work during playback and scrubbing.** Nested sequence assets are looked up only while their clips are active, so cuts elsewhere in the timeline no longer add asset lookup and preparation work to each sample.
