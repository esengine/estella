// Rich Text — a live playground for the Text component's rich-text markup and the
// TextInput widget. The field below the preview holds raw markup; every edit
// (including IME composition for CJK) re-renders the preview through the same
// `<b>/<i>/<color>/<font size>` pipeline. A static legend shows every tag.
import { addStartupSystem } from 'esengine';

import { buildSystem } from './systems/build';

addStartupSystem(buildSystem);
