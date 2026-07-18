// Render Texture — offscreen rendering with the RenderTexture API:
//
//   • A world of colored shapes drifts along orbits far beyond the camera's
//     view — most of the world is offscreen at any moment.
//   • A corner minimap quad shows all of it live: every frame a system paints
//     the world schematically into a RenderTexture with the immediate Draw
//     API, and the quad's Sprite samples the target's textureId.
//   • R cycles the target's resolution through 96×60 → 192×120 → 384×240 →
//     768×480 at a fixed display size — resize() returns a NEW handle whose
//     textureId the sprite must be re-pointed at.
//
// RenderTexture is a low-level surface: a camera cannot target it, and it does
// not re-render the scene. It redirects Draw commands issued between begin()
// and end() into an offscreen target, under a view-projection you supply.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { orbitSystem } from './systems/orbit';
import { minimapSystem } from './systems/minimap';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, orbitSystem);
addSystemToSchedule(Schedule.Update, minimapSystem);
