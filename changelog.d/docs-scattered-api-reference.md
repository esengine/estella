---
section: Changed
commits:
  - "docs: cover the presented camera, pixel readback, weather state, material subgraphs and prefab owners"
---
**Five APIs the manual never named are now documented.** The camera page explains `PresentedCameraView`, `CameraCommit`, `onCameraCommitChanged` and `cameraFrustumCorners`, for anything drawn over the canvas that has to match the picture. Render textures gain a section on reading pixels back with `captureFramePixels` and `captureTargetPixels`. Weather lists every `WeatherState` field with its neutral value, plus `blendWeather`, `currentWeather` and the preset lookups. Material graphs in code gain a Subgraphs section (`flattenSubgraphs`, `extractSubgraph`, `validateSubgraph` and the rest), and the prefab `instantiate` reference adds the missing `owner` option. In English and Chinese.
