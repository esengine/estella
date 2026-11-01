// Render Texture: a minimap painted into a RenderTexture every frame (R cycles its resolution),
// and four sprites cut from one TextureAtlas canvas along the bottom (systems/atlas.ts).
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { orbitSystem } from './systems/orbit';
import { minimapSystem } from './systems/minimap';
import { atlasSystem } from './systems/atlas';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, orbitSystem);
addSystemToSchedule(Schedule.Update, minimapSystem);
addSystemToSchedule(Schedule.Update, atlasSystem);
