---
section: Fixed
commits:
  - fix(ui): every hex colour is read by col.fromHex - rich text, the scene-transition colour and the picture code each parsed hex on their own and had drifted: <color=#f00> was ignored, a scene-transition colour with an alpha lost it and a short #rgb one became NaN, and rich text took a malformed digit as part of a number
---
**Rich text, the scene-transition colour and picture recipes read hex colours the same way.** `<color=#f00>` in rich text was ignored and only six- or eight-digit colours worked there; a scene-transition colour with an alpha lost it, and a short `#rgb` one came out as no colour at all. All three now read `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, and a value that is not a colour says what was expected.
