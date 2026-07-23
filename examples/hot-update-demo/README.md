# Hot Update Demo

Ship a game, then change its art **on a CDN** and have running clients pick up the
new bytes — no re-download of the package, no store re-submission. This example
shows the whole loop on a single sprite.

## How it works

Estella assets are **content-addressed**: a cooked asset ships as
`<contentHash>.<ext>`, an immutable, permanently-cacheable URL. Change a byte →
new hash → new URL. A hot update is therefore just: *fetch the new manifest,
diff it, download the assets whose hash changed, swap the active manifest.*
Nothing is ever overwritten, so a cache can never go stale.

### The pieces

- **`assets/cdn/art.png`** — a texture assigned to a **`remote` group** by the
  project's delivery config, so it's delivered from a CDN (bundle mode `remote`),
  not baked into the package.
- **`.esengine/asset-groups.json`** — the delivery config. `assets/cdn` is an
  ordinarily-named folder; the config is what marks it a remote group, and build
  profiles (`dev` / `prod`) carry the CDN root per environment:
  ```json
  {
    "groups": { "cdn": { "folder": "assets/cdn", "mode": "remote" } },
    "activeProfile": "dev",
    "profiles": { "dev": { "remoteRoot": "" }, "prod": { "remoteRoot": "https://cdn.example.com/hot-update-demo" } }
  }
  ```
  (The legacy `remote/<name>/` / `subpackages/<name>/` folder names still work as a
  zero-config default when there is no `asset-groups.json`.)
- **`assets/scenes/main.esscene`** — the Display sprite references the texture by
  an ordinary `@uuid`. The asset lives in a `remote` group, so the runtime routes
  that `@uuid` to the CDN automatically — the scene author does nothing special.
- **No game code.** `src/main.ts` is empty. When an update is applied the runtime's
  built-in rebinder reloads the changed asset (now resolved to the CDN) and swaps
  it into the live sprite, so the picture changes on screen on its own. (A game can
  still call `Assets.loadGroup(name)` to pull a whole remote group on demand — the
  DLC pattern — or `Assets.onInvalidate` for custom rebinding.)
- **The update** — call `Assets.checkForUpdate({ manifestUrl, remoteRoot })` to
  diff the CDN's manifest against the running one, then `Assets.applyUpdate()` to
  download the changed assets and swap the manifest. Existing handles bound to a
  changed asset are told to rebind. `Assets.restorePersistedUpdate(key)` at boot
  makes a returning player start on the already-updated content, even offline.

```ts
const plan = await assets.checkForUpdate({
  manifestUrl: 'https://cdn.example.com/asset-manifest.json',
  remoteRoot:  'https://cdn.example.com',
});
if (plan.hasUpdate) await assets.applyUpdate();
```

The whole path is content-addressed and platform-uniform: the same
`asset-manifest.json` + `loadGroup` + hot-update work on web, desktop, and
mini-games.

## Verify it

The engine ships an automated render check that proves the loop end-to-end —
cooks the game (green art), cooks a CDN update (red art), boots the shipped
runtime, asserts it draws **green**, drives the update, and asserts it draws
**red**:

```
pnpm --filter @estella/editor verify:render:hotupdate
```
