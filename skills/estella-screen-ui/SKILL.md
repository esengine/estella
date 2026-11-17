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

## The pieces

- `Canvas` on the root: `designResolution` (e.g. 1920x1080) and `scaleMode` decide how the box fits the window.
- `UINode` on every node: `width` / `height` as `{ value, unit }` (unit 0 pixels, 1 percent of the parent, 2 auto),
  insets (`insetLeft`, `insetTop`, ...) with `position` Absolute to pin a node to an edge, or flex (`FlexContainer` on the
  parent: direction, gap, alignment) to line nodes up.
- `UIVisual`: what the node draws behind its children. **`visualType` decides whether it draws at all, and it starts at
  None**: set SolidColor (1) for a coloured panel, Image (2) for a `texture`, NineSlice (3) with `sliceBorder` for a panel
  that stretches without smearing its corners. A `color` on a None visual draws nothing.
- `Text`: `content`, `fontSize`, `color`, alignment. Inside a UINode it is laid out in the node's box.
- `Interactable` + `UIInteraction`: makes a node clickable; `UIInteraction` says `hovered`, `pressed`, `justPressed`.

## The fast ways

- A HUD label anchored to a corner or edge: `create_hud_text { text, at: "top-left" | ... | "bottom-right", fontSize }`.
  It reuses the scene's Canvas or makes one.
- Ready-made controls (button, slider, toggle, dropdown, scroll list, dialog): `list_entity_templates`, then
  `apply_scene_ops { ops: [{ op: "create", template, parent }] }` under the Canvas.
- A click that does something without code: `wire_ui_event { entity, event: "click", action, params }`. It adds to the
  wires the entity already has.
- A click that runs game code: a system that queries `UIInteraction` and reacts to `justPressed`.

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
passes every check but sits off the edge of the screen is still wrong.
