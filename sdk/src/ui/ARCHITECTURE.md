<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team -->

# UI Module Architecture

The UI module is an **ECS-native** UI system: UI is built from the same
entities, components, and systems as the rest of the engine — there is no
separate retained widget tree. Layout is **flexbox** (Yoga-driven in the C++
core), text is rendered through an **SDF glyph atlas**, and styling flows from
a **design-token** theme.

This document is the contract that keeps the module *unified*. Read it before
adding a file. The rules below exist because the module previously accreted
parallel export surfaces, back-compat shims, and root-level files that broke the
layering — that drift has been removed and should not come back.

## Layer model

Layers depend **downward only**. A file may import from its own layer and any
layer above it in this list; it must **not** import from a layer below it.

```
Layer 0  Events        core/events.ts                      (the UI event bus)
Layer 1  Primitives    core/  + layout/flex.ts             (components = data)
Layer 2  Behaviors     input/  behavior/                   (interaction, FSM, drag, focus)
         Layout/Render layout/  render/                    (Yoga driver, masking, draw order)
Layer 3  Collection    collection/                         (lists, scroll, virtualization)
Layer 4  Widgets       widgets/                            (factory functions: button, dialog, …)
Cross    Text          text/                               (SDF/atlas/rich-text pipeline)
Cross    Theme         theme/                              (design tokens)
Cross    Util          util/                               (pure helpers, math, types, constants)
```

`util/`, `text/`, and `theme/` are cross-cutting: they sit beside the layers and
may be used by any of them, but they must **not** import *up* into behaviors,
collection, or widgets.

## Directory map

| Folder | Responsibility | Key files |
|--------|----------------|-----------|
| `core/` | Layer 0–1 primitives: the components that *are* the UI | `ui-node`, `ui-visual`, `ui-mask`, `text`, `dimension`, `events`, `ui-camera-info` |
| `layout/` | Flexbox layout + safe area + layout bookkeeping | `flex`, `layout` (Yoga driver plugin), `safe-area`, `ui-layout-generation` |
| `input/` | Pointer/keyboard interaction primitives + their plugins | `interactable`, `draggable`, `focusable`, `drag`, `focus`, `interaction` |
| `behavior/` | Stateful behavior layer (FSM + visual states) | `state-machine`, `state-visuals`, `systems`, `plugin` (UIBehaviorPlugin) |
| `render/` | UI-specific render concerns | `mask`, `render-order` |
| `collection/` | Data-driven collections + view recycling | `list-view`, `scroll-container`, `view-pool`, `data-source`, `layout-provider` |
| `text/` | SDF glyph atlas, text layout, rich text, editable text | `glyph-atlas`, `text-renderer`, `layout`, `rich-text-*`, `text-input`, `image-resolver` |
| `theme/` | Design tokens | `tokens` |
| `util/` | Cross-cutting helpers (no engine state of their own) | `helpers`, `math`, `types`, `constants`, `property-path` |
| `widgets/` | Layer-3 widget **factory functions** | `button`, `toggle`, `slider`, `progress`, `dialog`, `dropdown`, `helpers` |

Only two files live at the module root, and that is deliberate:

- **`index.ts`** — the module's single public barrel (see below).
- **`ui-plugin.ts`** — `uiPlugin`, the one composed pipeline that builds every
  concept plugin in dependency order. Apps add this single plugin; the concept
  plugins stay individually exported for granular/test wiring only.

## The single public surface (no parallel barrels)

There are exactly two export surfaces, with distinct jobs:

1. **`ui/index.ts`** is the *complete* module surface — everything the module
   offers, including low-level text/atlas internals for advanced use.
2. **`sdk/src/core-ui.ts`** promotes the *stable, curated* subset into the
   top-level `esengine` namespace. It re-exports **only** intentional public
   API — never `@internal` glue (`withChildEntity`, `setEntityColor`,
   `EntityStateMap`, …). Those stay importable from `./ui` for SDK-internal use.

Rules:

- **Do not** create a third re-export file for UI symbols, and do not hand-copy
  a symbol into more than one barrel "for convenience." Add it once, in the
  layer file, and export it through `index.ts`.
- **No back-compat shim files.** When a symbol moves, repoint every importer and
  delete the old file in the same change. (The `behavior/{interactable,draggable,
  focusable}.ts` and root `SafeArea.ts` shims were removed for exactly this
  reason.) A grep for the old path must come back empty.

## Conventions

- **File names are `kebab-case`** (`ui-camera-info.ts`, not `UICameraInfo.ts`).
  Exported *symbols* keep their natural casing (`UICameraInfo`, `createButton`).
- **A concept's component and its plugin are co-located** in one file when small
  (e.g. `layout/safe-area.ts` holds both `SafeArea` and `SafeAreaPlugin`).
  Split into `<concept>.ts` (component) + `<action>.ts` (plugin) only when the
  plugin is substantial (e.g. `input/draggable.ts` + `input/drag.ts`).
- **Components are data** — define them with `defineComponent` / `defineBuiltin`
  and keep behavior in systems, not on the component.
- **Widgets are factory functions** (`createX`) that compose primitives; they do
  not introduce a parallel widget hierarchy.

## Checklist before adding/moving a file

- [ ] It lives in the layer folder that matches its responsibility (root is off-limits).
- [ ] Its name is `kebab-case`.
- [ ] It imports only downward / cross-cutting — never up a layer.
- [ ] It is exported through `index.ts` exactly once; promoted to `core-ui.ts`
      only if it is stable public API (no `@internal`).
- [ ] No shim left behind: old import paths grep clean.
- [ ] `npx tsc --noEmit -p sdk/tsconfig.json` and `npx vitest run ui` both pass.
