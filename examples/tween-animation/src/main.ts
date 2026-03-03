import { addStartupSystem } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';

addStartupSystem(setupSystem);
