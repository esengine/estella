# estella-plugin-ldtk

Import [LDtk](https://ldtk.io) levels into Estella as Tiled maps, which the engine
loads natively.

```bash
npm install estella-plugin-ldtk
```

The editor lists it in **Window ▸ Plugins**, where it needs your approval before
it runs — like any plugin, and again after an update.

## What it does

Drop a `.ldtk` file anywhere in your project. Every time it changes, each level is
written as a `.tmj` beside it, in a folder named after the source:

```
assets/levels/world.ldtk
assets/levels/world/Level_0.tmj      ← generated
assets/levels/world/Level_1.tmj      ← generated
```

Point a `TilemapLayer` at one of those and it draws. **Reimport** in the Content
Browser re-runs the conversion by hand.

What crosses over: tile layers and auto-layers, their tilesets (image, grid,
spacing, padding), tile flips, layer order and opacity. Tileset images are
re-based onto the map's own folder, so the map resolves them wherever it lands.

What does not, yet: entity layers, IntGrid values, level fields, and worlds laid
out in LDtk's world grid — a level becomes a map of its own, not a tile in a
larger one.

## Built on the public API

Nothing here reaches into the engine: it is an editor plugin using
`ctx.assets.registerImporter`, `ctx.fs.readProject` / `writeProject` (which is why
it declares the `fs:project` capability), and one agent tool so the built-in agent
can run the import too. The conversion itself is a pure function over JSON —
`src/convert.ts`, tested on its own.

Apache-2.0.
