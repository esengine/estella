# Hot Update Demo

Ship a game, then change its content **on a CDN** and have running clients pick up
the new bytes — no re-download of the package, no store re-submission. This example
turns that whole loop into an interactive **hot-update center**: a status line, a
plan summary, a real download **progress bar**, and two buttons, all built from the
engine's own UI widgets driving the engine's own `Assets` hot-update API.

The screen has three parts, all authored in `assets/scenes/main.esscene`:

- a full-screen **remote content** sprite (green) — a `remote`-group texture the
  hot update swaps;
- a **DLC tile strip** — six placeholders you fill on demand;
- an **update console** — status, plan, progress bar, and the `下载资源包` /
  `检查更新` buttons.

`src/` is behavior only: `systems/build.ts` resolves the scene widgets and wires
the buttons to the API; `systems/update.ts` mirrors state onto the widgets each
frame. The layout lives in the scene — the code never builds UI.

## The two flows

### 1. On-demand download (the DLC pattern) — watch it download

`assets/pack/` is a `remote` group the scene does **not** reference, so nothing
loads it at boot. Press **下载资源包** and the game calls:

```ts
await assets.loadGroup('pack', (loaded, total) => {
  progress.setValue(loaded / total);        // real per-file progress
});
```

The progress bar fills as the six tiles arrive, then each is bound into its slot:

```ts
const tex = await assets.loadTexture('assets/pack/tile0.png'); // path ref, resolved via the group
tile.texture = tex.handle;
```

This flow is fully interactive in editor Play — click Play, press the button, and
watch the bar fill and the tiles reveal.

### 2. Content hot-update — swap shipped content

Press **检查更新** and the game diffs a candidate manifest against the running one:

```ts
const plan = await assets.checkForUpdate({ manifestUrl, remoteRoot });
// plan.changedAssets, plan.totalBytes, plan.fromRevision → plan.toRevision
if (plan.hasUpdate) {
  const result = await assets.applyUpdate((loaded, total) => {
    progress.setValue(loaded / total);      // download + integrity-verify progress
  });
  // result.ok → the remote sprite hot-swaps on screen (built-in rebinder);
  // on any failure NOTHING is applied — the update rolls back atomically.
}
```

The candidate manifest defaults to a **checked-in local update channel** —
`updates/v2-manifest.json` + `updates/art-v2.png` — so the content swap is live in
editor Play with no CDN: press Play, watch the boot auto-check report **发现新版本 ·
1 个文件 · 208 B**, press **下载并更新**, and the background sprite turns from green
to red (`applyUpdate` downloads the v2 texture, verifies its `contentHash`, and the
built-in rebinder swaps it in). `v2-manifest.json` is a full manifest that mirrors
the running one with only the `cdn` texture bumped, so the diff is exactly one
changed asset.

The channel lives **outside `assets/`**, so a cooked build never bundles it: the
same URL 404s and a shipped build honestly reports **已是最新版本**. A real
deployment sets `window.__estellaHotUpdate` to point at its CDN instead — and the
render verify below exercises that path against a genuinely cooked,
content-addressed CDN update.

## How it works — content addressing

Estella assets are **content-addressed**: a cooked asset ships as
`<contentHash>.<ext>`, an immutable, permanently-cacheable URL. Change a byte →
new hash → new URL. A hot update is therefore just: *fetch the new manifest, diff
it by `contentHash`, download the assets whose hash changed, swap the active
manifest.* Nothing is ever overwritten, so a cache can never go stale, and
`applyUpdate` verifies every downloaded file's hash before committing.

The delivery config is `.esengine/asset-groups.json`: `assets/cdn` and
`assets/pack` are ordinarily-named folders the config marks as `remote` groups,
and build profiles (`dev` / `prod`) carry the CDN root per environment:

```json
{
  "groups": {
    "cdn":  { "folder": "assets/cdn",  "mode": "remote" },
    "pack": { "folder": "assets/pack", "mode": "remote" }
  },
  "activeProfile": "dev",
  "profiles": { "dev": { "remoteRoot": "" }, "prod": { "remoteRoot": "https://cdn.example.com/hot-update-demo" } }
}
```

The scene references the `cdn` texture by an ordinary `@uuid`; because it lives in
a `remote` group the runtime routes it to the CDN automatically, and the built-in
rebinder swaps the live sprite when an update is applied — the swap needs zero
game code. The whole path is platform-uniform: the same manifest + `loadGroup` +
hot-update work on web, desktop, and mini-games.

## Verify it

The engine ships an automated render check that proves the content-swap loop
end-to-end — cooks the game (green art), cooks a CDN update (red art), boots the
shipped runtime, asserts it draws **green**, drives the update, and asserts it
draws **red**:

```
cd desktop && npm run verify:render:hotupdate
```
