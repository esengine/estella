# Video Playback

Play a video file on a Sprite using the **`Video`** component.

![tag:Rendering](https://img.shields.io/badge/tag-Rendering-blue)

## What it shows

The `Screen` entity carries a `Sprite` **and** a `Video`. The engine's video
system streams `assets/video/clip.mp4`, decodes each frame into a live GPU
texture, and drives the Sprite's texture from it every frame — so a video is
simply "a Sprite whose texture is alive." The Sprite's normal properties
(layer, tint, material, flip, lighting) all apply to the video unchanged.

The scene is fully declarative — there is no gameplay code (`src/main.ts` is
empty). Add a `Video` next to a `Sprite`, point `source` at a clip, and it
plays.

## The `Video` component

| field | meaning |
|-------|---------|
| `source` | project-relative path / ref of the clip (`.mp4`, `.webm`) |
| `autoplay` | start as soon as the clip is ready |
| `loop` | restart at the end |
| `muted` | mute the clip's own audio track |
| `volume` | audio-track volume, `0..1` |
| `playbackRate` | speed multiplier |
| `fitSize` | on first frame, resize the Sprite to the clip's native pixels |

## Code-driven playback

For cutscenes/splashes, use the imperative service instead of the component:

```ts
import { VideoPlayer } from 'esengine';

const video = app.getResource(VideoPlayer);
const handle = video.play('assets/video/clip.mp4', { loop: true, muted: true });
handle.onEnded = () => console.log('finished');
// once handle.isReady, sample handle.textureHandle from any Sprite/material.
```

## Platforms

Web / desktop decode through the platform `<video>` element (hardware,
zero-copy on WebGL2); WeChat MiniGame decodes through the engine's own wasm
MPEG-1 decoder — the export cook transcodes the clip to `.esv` and demuxes its
audio track automatically, so the same scene ships everywhere unchanged. Both
paths are pixel-verified headless (`verify:render:video[:ui]`).

For many surfaces sharing ONE stream (e.g. a puzzle of live tiles), see the
**video-puzzle** example.
