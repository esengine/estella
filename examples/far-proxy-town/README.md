# Far Proxy Town

A town of 144 streamed cells, 80 units each, flown over on a fixed loop. Only the cells near the flyer (and near a second source
over the mill) are loaded; every other cell is drawn by its far proxy, baked by the build from that cell's static meshes.

What is in it, and what each piece checks:

- **Houses** of three kinds, placed as prefab instances (by path and by uuid), some with a **nested chimney prefab** and some with
  a tint override. Their **windows are see-through**, so no proxy carries them.
- **Trees** with rounded crowns of overlapping spheres: what simplification has to keep the shape of.
- A **clock tower** built as a hierarchy turned and scaled at its root, so a proxy has to compose the whole parent chain.
- A **market square** of stalls whose canopies differ only in colour: those share one draw in a proxy.
- **Carts on dynamic bodies** and a **ferry on a kinematic body**: they move, so no proxy carries them.
- **Windmill sails** turned by the game's own system with no body: their hub carries `ExcludeFromFarProxy`, so no proxy shows
  them frozen.
- **Scaffolding** that is disabled, and a **field with nothing static on it** but ground.

`scripts/build-town.mjs` writes every asset and the scene (seeded, so it writes the same files each time). `src/main.ts` flies the
camera and turns what moves; the flight runs on its own clock, which `farProxyTown.restart()` sets back to zero.

`node tools/verify-far-proxy-town.mjs` builds this example three ways (far proxies, none, every cell loaded), flies each package
the same frames in headless Chromium, and compares the pictures and what is resident at each sample.
