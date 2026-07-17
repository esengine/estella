// Chat — the clearest showcase for two UI widgets working together: a virtualized
// message log (createListView, recycling ~10 entities for the whole history) and
// an editable composer (createTextInput) with a Send button. Enter or Send appends
// your message and a canned bot reply, and the list auto-scrolls to the newest.
import { addStartupSystem } from 'esengine';

import { buildSystem } from './systems/build';

addStartupSystem(buildSystem);
