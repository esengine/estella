// UI Layout — a live flexbox playground. buildSystem spawns a real FlexContainer of
// item boxes plus cycle-buttons that drive its flex-direction / justify-content /
// align-items / flex-wrap / item-count; the Yoga pass re-flows them each frame.
import { addStartupSystem } from 'esengine';

import { buildSystem } from './systems/build';

addStartupSystem(buildSystem);
