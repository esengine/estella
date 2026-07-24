// Hot-update demo. The scene (assets/scenes/main.esscene) authors the whole
// UI — a background "remote content" sprite the hot update swaps, a DLC tile
// strip, and an update console. These two systems are behavior only: build wires
// the buttons to the engine's Assets hot-update API; reflect mirrors state onto
// the scene-authored widgets each frame.
import { addSystemToSchedule, Schedule } from 'esengine';

import { buildSystem } from './systems/build';
import { updateSystem } from './systems/update';

// Both run on Update: build no-ops until the Canvas subtree loads (then builds
// once); reflect no-ops until build has resolved the widgets.
addSystemToSchedule(Schedule.Update, buildSystem);
addSystemToSchedule(Schedule.Update, updateSystem);
