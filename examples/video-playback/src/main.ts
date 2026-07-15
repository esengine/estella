// SPDX-License-Identifier: Apache-2.0
// Video Playback — the Video component is fully declarative: the "Screen"
// entity in main.esscene carries a Sprite + a Video, and the engine's video
// system decodes the clip into a live texture and drives the Sprite each frame.
// So this example needs no gameplay code at all.
//
// For code-driven playback (cutscenes, splash screens) you can instead reach
// the imperative service and play onto any Sprite's texture yourself:
//
//   import { VideoPlayer, Sprite } from 'esengine';
//   const video = app.getResource(VideoPlayer);
//   const handle = video.play('assets/video/clip.mp4', { loop: true, muted: true });
//   handle.onEnded = () => console.log('done');
//   // each frame, once handle.isReady:  sprite.texture = handle.textureHandle
//
// Nothing to register here — the scene drives everything.
export {};
