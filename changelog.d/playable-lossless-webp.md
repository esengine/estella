---
section: Changed
commits:
  - perf(export): a playable's images are lossless WebP whenever that is smaller, not only once the package is over its budget - a playable carries every image as base64 in its one HTML file, a third larger than the PNG, and below the budget nothing shrank it; lossless loses nothing, so it now runs on every export that compresses, and only the lossy qualities still wait for the budget
---
**A playable's images are lossless WebP whenever that is smaller.** A playable is one HTML file, so each image rides in it as base64, a third larger than the file itself. WebP re-encoding used to start only once the package went over its size budget (the network's limit, the project's, and 3 MB at most), so a playable under budget shipped every PNG as it was. Lossless WebP changes no pixel, so it is now applied on every playable export with asset compression on, to each image it makes smaller; a PNG carrying a colour profile, gamma, animation or 16-bit samples stays PNG as before. The lossy qualities (WebP 90 and 80) and MP3 audio still wait for the budget to be exceeded. In the 2D platformer template, the three images it re-encodes went from 11.7 KB to 3.7 KB.
