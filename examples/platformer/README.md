# Platformer

Run the project in the editor or export it for Web. Move with Left/Right or A/D;
jump with Space. Collect coins while climbing the platforms.

## Stretchable platforms

The four platforms use `Sprite.drawMode = NineSlice` and the existing
`platform.png` texture. Its import settings define an 8-pixel border on each
side. The platforms have different widths; their corners remain 8 pixels wide.
The border belongs to the texture importer, so Sprite and UI share one definition.

Select a platform and use the Rect tool (`T`) to drag its edge. This changes
`Sprite.size`, leaving `Transform.scale` alone. Undo restores the size and position.
When changing the playable width, also adjust `BoxCollider2D.halfExtents.x` to
`Sprite.size.x / 200` (the project uses 100 pixels per physics metre).

The pixel probe checks a fivefold stretch, shared UI corners, batch counts and
legacy Auto behavior on both backends. From the repository root:

```sh
pnpm render-host
node tools/sprite-nine-slice-browser.mjs
```

Open each printed URL in a browser and click **Run pixel checks**. This workflow
does not start a desktop application. Set `PROBE_OUTPUT` to retain JSON reports.
