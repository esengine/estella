// Trails — a tour of the built-in trail renderer. The three emitters are
// authored in the scene, each a sprite plus the tuned `TrailRenderer` that makes
// it leave a streak; project systems only move them. Controls: README.md.
import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/labels-setup';
import { motionSystem } from './systems/motion';
import { controlSystem } from './systems/control';
import { labelSystem } from './systems/labels';

addSystemToSchedule(Schedule.Update, setupSystem);
addSystemToSchedule(Schedule.Update, motionSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, labelSystem);
