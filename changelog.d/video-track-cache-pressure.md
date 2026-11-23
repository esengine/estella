---
section: Fixed
commits:
  - fix(audio): keep video tracks resident until playback starts
---
**Videos keep their sound when several tracks start together under memory pressure.** The audio cache now holds each requested track until its player starts, including when a scene releases the clip or the host trims the cache during startup.
