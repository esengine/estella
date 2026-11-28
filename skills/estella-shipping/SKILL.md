---
name: estella-shipping
description: How to take an Estella game out of the editor - check it can ship, export it for the web, desktop, WeChat and other mini-games, playable ads, Android or iOS, keep it inside each platform's size limit, and prove it runs where it ships with a development build the editor can see. Read it before exporting or publishing a game.
---

# Shipping

A game is shipped when it runs on the target, not when the export says ok. The order: check, export, read the report,
then see it run there.

## Before exporting

- `save_scene`: an export reads what is on disk, and unsaved changes are a blocker.
- `get_project_health { target }` is the Build dialog's own preflight. A `blocker` stops the export; a `warning` ships
  and is worth reading (an empty required field is one). `unavailable` lists checks that did not run, not checks that
  passed.
- Every scene in the scenes folder ships unless it was unticked in the Build dialog; the startup scene always does. A
  playable ships the startup scene only.

## Export

`export_game { platform }` with `platform` one of `web`, `desktop`, `wechat` and the other mini-game targets the
Build dialog lists, `playable`, `android`, `ios`. It writes `dist-<platform>/` unless `outDir` says otherwise.

- A content blocker (a dead reference, unsaved changes, no entry scene) can be passed with `acknowledgeBlockers: true`
  only when you can say why it does not matter; a missing toolchain cannot be passed.
- Compression is off unless the call or the chosen `profile` asks for it: `compressTextures` (KTX2), `compressAudio`
  (WAV to MP3) and `atlasTextures` follow each asset's Import Settings. Turn them on for a release, not for a quick check. A texture whose width or
  height is not a multiple of 4 ships raw, and the warning names it.
- `profile` picks one of the project's saved export profiles; `debugChannel: true` makes a development build that
  connects back to this editor (below).
- Every recording you did not make goes through `sound_conform` with its `credit` before it ships: it levels music and
  ambience to one loudness, loops without a click, and keeps CREDITS.md. A CC BY licence also needs the author shown to
  players on a credits screen; an ND or NC licence cannot ship in an edited or commercial game.

## Size

The result weighs the package: **initial** (downloaded before the game plays), **on demand** (subpackages) and **CDN**
(remote asset groups, outside the package). Limits are reported, not enforced:

- WeChat: 4 MB main package, 30 MB with all subpackages. Move levels behind subpackages or remote groups; a game that
  never uses particles, post-processing or tilemaps gets the smaller engine on its own.
- Playable: one `index.html` with everything inlined, at most what the chosen ad network accepts (often 5 MB).
  `webpImages` (`"lossless"`, 90, 80) shrinks its images; the game calls `playableCta()` where the player is sent to
  the store and never names a network.
- Web, desktop, Android, iOS: no published limit; read the largest files the report lists anyway.

## Per platform

- **Web**: needs an http origin; `index.html` opened from disk does not load the wasm. Serve the folder (the Build
  dialog's Preview over http does) or upload it to a static host.
- **WeChat and other mini-games**: open the folder in that platform's developer tool; WeChat's AppID is in Project
  Settings (packaging) or its `project.config.json`. Game code must not use `BigInt64Array` or `BigUint64Array`:
  WeChat's developer tool does not have them, so a game that runs on a phone stops in the tool.
- **Android / iOS**: native apps, not a WebView. They need the runtime template the Build dialog's row offers to
  download once per editor version; with it Android writes a signed APK. iOS also needs a Mac with Xcode to sign.
- **Desktop**: a native app per installed desktop template; Steam is a channel of it.

## Prove it runs there

Export with `debugChannel: true`, start the build on the device or in the browser, and it appears in
`device_targets` with a `realm`. Then, on the device itself:

- `device_screenshot { realm }`: what the player sees. A frame of one flat colour is a game that draws nothing.
- `device_control { realm, paused, step }` to stop it at a moment, `inspect_device { realm }` to read its world.
- `capture_frame { realm }` for its draws; `set_profiler_source { source: realm }` then `profile_frames` for its frame
  time, which is the number that matters, not the editor's.
- `device_update_status { realm }` for which content revision it runs after a hot update.

Report what ran where: the platform, the package size against its limit, and what the device showed. An export that
built but was never started on its target is not shipped, and say so if that step could not be done here.
