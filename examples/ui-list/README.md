# UI List

A data-driven, **virtualized** list and grid built with `createListView` — the
one-call widget over the collection primitives (`DataSource` + `LayoutProvider`
+ view pool + scroll container + `UIMask` clipping).

Two collections run side by side:

- **Contacts** (left) — a 500-row vertical list. Only a screenful of row
  entities ever exists; they're recycled and re-bound as you scroll. Each row
  is a zebra-striped container with a hue stripe and a label, all rebound in
  the item template's idempotent `bind`.
- **Tiles** (right) — the same widget in grid mode (`columns: 4`), 120 tiles
  colored by index.

The stats line at the bottom is the proof of virtualization: the *mounted*
entity counts stay flat (~10 for the list) no matter how many rows the data
source holds.

## Controls

| Input           | Action                                                  |
| --------------- | ------------------------------------------------------- |
| Mouse wheel     | Scroll whichever list is under the cursor               |
| **+ Append row**  | `data.append(…)` — the list grows live, then jumps to it |
| **− Remove first** | `data.remove(0)` — rows above re-bind in place          |
| **Top / End**   | `scrollToIndex()` — programmatic jumps                  |

## What it shows

- `createListView` with both layout sugars: `{ itemHeight }` (column list) and
  `{ columns, itemSize }` (grid).
- A raw `ArrayDataSource` as the backing store — mutate it (`append` /
  `remove` / `update`) and the widget re-syncs; there is no manual refresh.
- `ListItemTemplate` — `create` builds a pooled row once, `bind` re-applies
  data on every recycle, so it must be idempotent.
- `scrollToIndex` and the `mountedCount()` escape hatch.

The scene authors the static frame (panel, headers, empty slots); the startup
system finds the named slots and instantiates the widgets — the same
scene-plus-factories split as the `ui-controls` example.
