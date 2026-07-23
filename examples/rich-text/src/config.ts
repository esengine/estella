// The markup the field seeds with — a mix of a color run, bold, italic and a
// CJK word so the very first frame shows rich text *and* invites an IME edit.
export const SEED_MARKUP =
    'Hello <b>世界</b> <color=#ffcc33>Estella</color> <i>rich text</i>!';

// The static reference panel: one line per supported tag, each rendered rich so
// the demo doubles as a legend — including an inline `<img>` (an icon flowed in
// with the text, valign-centered on the line).
export const SAMPLES: readonly string[] = [
    '<b>bold</b>   <i>italic</i>   <b><i>bold italic</i></b>',
    '<color=#ff5a5a>red</color> <color=#5aff8c>green</color> <color=#5a9cff>blue</color> <color=#ffd24a>gold</color>',
    'font size <font size=14>14</font>  <font size=22>22</font>  <font size=32>32</font>',
    'nested <color=#ffcc33>gold <b>bold</b> and <i>italic</i></color> back to plain',
    'inline image  HP <img src="assets/textures/heart.png" width=26 height=26 valign=middle/> <color=#ff5a6e>100</color>',
];
