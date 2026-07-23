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

- **`remote/cdn/art.png`** — a texture in a **`remote` group**. The
  `remote/<name>/` folder convention tells the cook this asset is delivered from
  a CDN (bundle mode `remote`), not baked into the package.
- **`src/systems/hotUpdate.ts`** — on start, calls `Assets.loadGroup('cdn')` to
  fetch the remote texture and stamps its handle onto the display sprite. It also
  subscribes to `Assets.onInvalidate` so that when an update lands, it reloads the
  group and the sprite follows.
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
