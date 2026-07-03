// UI Controls — a gallery of the imperative widget factories (createButton,
// createSlider, createToggle, createProgress, createDropdown, createDialog) styled
// from the design-token theme. The scene is just a Camera + Canvas; buildSystem
// spawns everything, and controls.ts ticks the slider drag + progress animation.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import { buildSystem } from './systems/build';
import { controlsSystem } from './systems/controls';

addStartupSystem(buildSystem);
addSystemToSchedule(Schedule.Update, controlsSystem);
