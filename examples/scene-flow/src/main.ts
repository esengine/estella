// Scene Flow — runtime multi-scene flow: SceneManager registration, load vs
// switchTo, and fade transitions (menu → level 1 → level 2 → menu).
import { addStartupSystem } from 'esengine';

import './components';
import { registerScenesSystem } from './systems/register';

addStartupSystem(registerScenesSystem);
