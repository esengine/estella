// UI Controls — a gallery of the SDK's imperative UI widget factories, built in
// code and styled entirely from the design-token theme (no literal RGBA):
//
//   • Button   — increments a click counter
//   • Toggle   — pauses / resumes the progress animation
//   • Slider   — 0..100 volume, drag the track (wired in systems/controls.ts)
//   • Progress — auto-animating ping-pong bar
//   • Dropdown — re-tints the slider + progress fills (a live theme accent)
//   • Dialog   — a modal opened by a button
//
// The scene carries only a Camera + Canvas; everything else is spawned by the
// startup buildSystem via createButton/createSlider/… + themeColors(). This is
// the modern, ECS-native path — widgets are factory functions that compose the
// same primitives you'd otherwise author in a scene.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import { buildSystem } from './systems/build';
import { controlsSystem } from './systems/controls';

addStartupSystem(buildSystem);
addSystemToSchedule(Schedule.Update, controlsSystem);
