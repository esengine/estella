# Audio — Drum Machine

A four-pad drum machine that shows off the engine's audio system: one-shot SFX
with per-hit variation, a looping beat on the music bus, per-bus volume control,
and a **real** spectrum visualizer driven by the master-bus analyser.

## Controls

| Input                          | Action                                   |
| ------------------------------ | ---------------------------------------- |
| `1` `2` `3` `4` / click a pad  | Kick / Snare / Hi-Hat / Clap             |
| **Beat** button                | Toggle the looping beat (music bus)      |
| **Master / Music / SFX**       | Click to cycle that bus's volume         |

## What it shows

- **Pads** play one-shots via `audio.playSFX(url, { pitch, pan })` — each hit
  gets a small random pitch and pan so repeats feel alive.
- **Beat** loops on the music bus via `audio.playBGM(url, { fadeIn })` /
  `audio.stopBGM(fade)`. (There's no music track here, so a kick loop stands in —
  enough to show the loop + fade + music-bus routing.)
- **Volume** buttons step each bus through the mixer with `setMasterVolume` /
  `setMusicVolume` / `setSFXVolume`, so you can hear the bus tree at work.
- **Visualizer** is a true frequency spectrum, not a canned animation.

## How it works

The visualizer is fed by a new SDK method, `audio.getSpectrum(out)`, which fills
a `Uint8Array` with the master output's frequency magnitudes (0-255 per bin).
Under the hood the WebAudio backend taps the master bus with an `AnalyserNode`
(a side branch, so it never alters the sound). Backends without analysis (e.g.
WeChat) return `false`, and the bars simply rest flat — the demo degrades rather
than breaks.

- **`visualizer.ts`** samples one analyser bin per bar each frame and sets the
  bar's `UINode` height. Louder frequencies → taller bars, so a kick lights the
  low bars and a hi-hat the high ones.
- **The buttons** are plain UI entities (`UINode` + `UIVisual` + `Interactable`
  + a tag/`VolumeKnob`); a click surfaces as a `'click'` UI event the systems
  read with `events.query('click').some(e => e.target === entity)`.

## Files

```
assets/
  scenes/main.esscene    # camera, pads, beat + volume buttons, spectrum bars
  audio/*.wav            # kick / snare / hi-hat / clap samples
src/
  main.ts                # registers the systems
  config.ts              # pad samples, beat url, volume steps, spectrum bins
  components.ts          # Pad, BeatToggle, VolumeKnob, VisualizerBar (+ labels)
  systems/
    preload.ts           # warm the buffer cache at startup
    sfx.ts               # pads → playSFX with pitch/pan variation
    beat.ts              # toggle the looping music-bus beat
    volume.ts            # cycle per-bus volume, update labels
    visualizer.ts        # real spectrum → bar heights (audio.getSpectrum)
```
