---
name: estella-screen-ui
description: How to build screen UI in Estella - a HUD, a menu, buttons, labels, panels - that stays on the screen at any window size and responds to clicks. Read it before adding any UI to an Estella scene.
---

# Screen UI

## The one rule that decides whether a HUD shows

Screen UI lives under a **Canvas** that is a root (no Transform parent). Everything under it is laid out by the UI layout,
in a box of the Canvas's design resolution fitted to the window, and drawn on top of every camera. A node's
`Transform.position` is **owned by the layout**: a value you set is overwritten at the next layout pass, without an error.
Place a node with its `UINode` (size, insets, flex), never with its Transform.

World UI (a nameplate over a unit) is the opposite: a Canvas parented under something in the world, or a Text with no
UINode, placed by Transform. Do not mix the two.

## Order and the pieces every node needs

- UI draws in **tree order**: a later sibling draws over an earlier one, a child over its parent. A background panel is the
  parent of what sits on it (or an earlier sibling); made as a later sibling, it covers the text it was meant to sit under.
- Every UI node needs a `Transform` as well as its `UINode`: the layout writes its placement there, and a node made without
  one draws in the wrong place.

## The pieces

- `Canvas` on the root: `designResolution` (e.g. 1920x1080) and `scaleMode` decide how the box fits the window.
- `UINode` on every node: `width` / `height` as `{ value, unit }` (unit 0 pixels, 1 percent of the parent, 2 auto),
  insets (`insetLeft`, `insetTop`, ...) with `position` Absolute to pin a node to an edge, or flex (`FlexContainer` on the
  parent: direction, gap, alignment) to line nodes up.
- `UIVisual`: what the node draws behind its children. **`visualType` decides whether it draws at all, and it starts at
  None**: set SolidColor (1) for a coloured panel, Image (2) for a `texture`, NineSlice (3) with `sliceBorder` for a panel
  that stretches without smearing its corners. A `color` on a None visual draws nothing.
- `Text`: `content`, `fontSize`, `color`, alignment. Inside a UINode it is laid out in the node's box. A Text whose
  `width` / `height` are left auto takes its text's size, so labels in a flex row or column stand apart by the `gap`
  with no sizes on them; with `wordWrap` in a column of fixed width it grows as tall as its lines.
- `Interactable` + `UIInteraction`: makes a node clickable; `UIInteraction` says `hovered`, `pressed`, `justPressed`.

## The fast ways

- A HUD label anchored to a corner or edge: `create_hud_text { text, at: "top-left" | ... | "bottom-right", fontSize }`.
  It reuses the scene's Canvas or makes one.
- Ready-made controls (button, slider, toggle, dropdown, scroll list, dialog): `list_entity_templates`, then
  `apply_scene_ops { ops: [{ op: "create", template, parent }] }` under the Canvas.
- A click that does something without code: `wire_ui_event { entity, event: "click", action, params }`. It adds to the
  wires the entity already has.
- A click that runs game code: a system that queries `UIInteraction` and reacts to `justPressed`.

## A HUD that looks made, not generated

A HUD reads as designed when it is restrained and precise, not when it is decorated. Panels with rounded corners, glows,
saturated colours and heavy type are what reads as generated. Build it from a few decisions held everywhere:

- **Tokens.** One accent (a muted gold `{ r: 0.906, g: 0.761, b: 0.49 }`, or the game's own), white at three strengths
  (`a` 0.95 for what matters, 0.64 for what supports it, 0.38 for hints), a near-black (`{ r: 0.03, g: 0.04, b: 0.055 }`),
  and nothing else. Colour means something: the accent marks the goal, the player's resource, the selected item.
- **Type.** Two faces at most: a display face for titles at a LIGHT weight (`Text.fontWeight` 200 to 300, 80 to 110 px for a
  title screen) and a text face for the rest (400, 15 to 20 px on a 1080-high canvas; 600 only for a heading). Titles a
  little spaced (`letterSpacing` 1 to 2), small capitals wider (`letterSpacing` 1 to 3). A number that changes (a timer, a
  count, a score) has `tabularNumbers: true`, so its neighbours do not shift. Ship the font: `Text.font` names a `.ttf`,
  `.otf`, `.woff` or `.woff2` in the project; a variable font draws every weight on its axis, a family of one file per weight
  needs a file per weight, and a system font (`fontFamily`) draws the nearest weight that machine has.
- **No panels behind HUD text.** Words stand on the world with two shadows that keep them legible over sky and snow: a
  tight one, `shadowColor { r: 0, g: 0, b: 0, a: 0.5 }`, `shadowBlur` 3, `shadowOffsetY` 1, and a wide one under it,
  `shadow2Color` the same, `shadow2Blur` 14, `shadow2OffsetY` 1. A shaded block goes only behind a block
  of words (a menu, a dialogue), and fades out rather than ending at an edge: a SolidColor `UIVisual` wearing a Gradient
  material, near-black at `a` 0.7 at the side the words are on to clear at the other.
- **Lines, not boxes.** Hairlines 1 px high, in the accent, fading out along their length (Gradient material). One small
  motif repeated, such as a 7 to 8 px square turned 45 degrees (a diamond) at the start of a hairline or before the goal:
  give its `Transform` `rotation: { w: 0.9238795, x: 0, y: 0, z: 0.3826834 }` when it is created; the layout keeps a turn.
- **Meters are thin.** Health 3 px, stamina 2 px, 200 to 260 px long, on a track of black at `a` 0.45. A ghost behind the
  fill in the accent says how much a blow took: give the track a `UIMeter` and two children that fill it, each a `UIVisual`
  of visualType Filled (5) with fillMethod Horizontal (0) and fillOrigin Left (0), the ghost (accent) first and the fill
  (white) over it; set `UIMeter.fill` and `UIMeter.ghost` to them. The game writes only `UIMeter.value` (0..1): a drop shows
  in the fill at once, the ghost holds the old amount for `holdTime` (0.25 s), then eases down over `fallTime` (0.6 s); hits
  in a row keep it up, so a combo reads as one loss; a heal climbs over `riseTime` (0.3 s for the whole bar).
- **A compass** is a strip 400 or so px wide whose two ends melt away. The letters and pins slide along it as the camera
  turns, so they sit under a `UIMask` (mode Scissor) with `softness: { x: 90, y: 0 }`: anything inside fades in over the
  outer 90 px instead of being cut at the edge. The hairline under them is one more child, or a Gradient with `u_fadeIn` and
  `u_fadeOut` 0.25. The goal is a small accent diamond on the line. The same soft mask fades a list or a ticker at its ends.
  It fades everything inside: UIVisual, Sprite, Text, and a visual wearing a material of its own.
- **Key hints** sit in a corner, small: a near-black keycap rect (`a` 0.72) with the key in 12 px at weight 600, the action
  beside it at the supporting white. Hide them once the player has used the key.

The **Gradient** material (`shader: "builtin:gradient"`) multiplies whatever the visual draws, a plain colour or a picture:

```json
{ "version": "1.0", "type": "material", "shader": "builtin:gradient", "blendMode": 0, "depthTest": false, "depthWrite": false,
  "cull": 0, "properties": { "u_from": { "r": 1, "g": 1, "b": 1, "a": 1 }, "u_to": { "r": 1, "g": 1, "b": 1, "a": 0 },
  "u_angle": 0, "u_middle": 0.5, "u_radial": 0, "u_fadeIn": 0, "u_fadeOut": 0 } }
```

The angle (u_angle) 0 runs from the rect's left edge to its right, 90 from its bottom to its top; u_radial 1 runs from its centre
out (a vignette); u_middle moves where the colour is halfway; u_fadeIn and u_fadeOut melt the start and the end to
clear over that share of the run. Write it with `write_project_file` (or `create_asset` type material) and set it as the
`UIVisual.material` of a SolidColor or Image visual. Then look at the HUD over the brightest and the darkest place the game
has (`screenshot { crop: "game" }`): a HUD that only works over one of them is not done.

## Changing UI from a script

Write through the world or a `Mut(...)` query so the engine sees it:

```ts
export const scoreSystem = defineSystem([Query(ScoreDisplay, Mut(Text))], (rows) => {
    for (const [_e, score, text] of rows) text.content = `Score: ${score.value}`;
}, { name: 'ScoreSystem' });
```

A label changed on the object `world.get(entity, Text)` returned keeps showing its old text: write it back with
`world.insert(entity, Text, text)`. Move UI that animates every frame by `Transform` only on nodes the layout does not own
(children of a non-layout node), or by tweening `UINode` insets; writing `UINode` every frame relays out the whole tree.

## Verify it

Read UI state from the running game in the acceptance:

```json
{ "frames": 30,
  "inputs": [{ "frame": 5, "kind": "click", "x": 960, "y": 540 }],
  "expect": [
    { "entity": "ScoreLabel", "component": "Text", "field": "content", "op": "==", "value": "Score: 0", "says": "the HUD shows the score" },
    { "entity": "StartButton", "component": "UIInteraction", "field": "hovered", "op": "==", "value": true }
  ] }
```

`play_input` coordinates are the game canvas in screen pixels, y down. Then `screenshot { crop: "game" }`: a HUD that
passes every check but sits off the edge of the screen is still wrong. A HUD is seen in Play: `view_from` and
`scene_views` draw the world and leave the screen's UI out.
