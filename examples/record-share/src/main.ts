// Record & Share — record a run, mark a highlight every few seconds, stop, and
// share the clip. Share is hidden where the host cannot share (the editor, a
// browser), which is what a real game wants too.
import { addPlugin, addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';
import { miniGameServicesPlugin } from 'estella-plugin-minigame-services';

import './components';
import { rotateSystem, colorPulseSystem } from './systems/animate';
import { recordUiSystem, recordStateSystem } from './record';

addPlugin(miniGameServicesPlugin);
addSystemToSchedule(Schedule.Update, rotateSystem);
addSystemToSchedule(Schedule.Update, colorPulseSystem);
addStartupSystem(recordUiSystem);
addSystemToSchedule(Schedule.Update, recordStateSystem);
