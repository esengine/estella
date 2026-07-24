// Orchestration surface the Swift host (EngineHost.swift) drives. Evaluated LAST, after
// prelude.js -> the engine glue (esengine_native.js, global ESEngineModule factory) ->
// the SDK bundle (estella-sdk.iife.js, global ESpike). Async ergonomics (module
// instantiation, the frame loop) stay in JS where Promises are natural; the host calls
// these typed entry points and pumps the run loop until the returned Promise settles.
(function (g) {
  var SDK = g.ESpike;          // esengine/native, bundled with esbuild --global-name=ESpike
  var Module = null;           // instantiated engine wasm
  var app = null;              // App instance (headless or rendered)

  function requireModule() { if (!Module) throw new Error('EstellaBoot: engine not instantiated'); return Module; }

  g.EstellaBoot = {
    // Instantiate the engine wasm. `wasmBytes` is an ArrayBuffer the host reads from disk.
    instantiate: function (wasmBytes) {
      return g.ESEngineModule({
        wasmBinary: wasmBytes,
        print: function (s) { __print('[wasm] ' + s); },
        printErr: function (s) { __print('[wasm] ' + s); },
      }).then(function (m) { Module = m; return true; });
    },

    // Install the native platform (fs / fetch / input / storage / image decode). `bridge`
    // is the JS object EstellaHostKit's NativeBridgeHost builds — it satisfies the
    // NativeBridge contract (sdk/src/platform/native/bridge.ts).
    installPlatform: function (bridge) { SDK.installNativePlatform(bridge); return true; },

    // Headless: the proven path — real ECS + transform propagation, NO renderer. Runnable
    // today; cross-validates the embedded-JSC no-JIT budget from a Swift host.
    createHeadless: function () { app = SDK.createHeadlessApp(requireModule()); return true; },

    // Rendered: inject the host-built native Dawn device + surface HANDLES, then create the
    // app whose WebGPU renderer ADOPTS the injected surface (RenderSurfaceSource injected
    // mode — REARCH_NATIVE.md §3.3, Fork A). `deviceHandle` / `surfaceHandle` are integer
    // ids the host registered into the wasm WGPU handle table.
    //   Reserved: requires the native Dawn provider + the emdawnwebgpu-on-JSC bridge (N2).
    createRendered: function (deviceHandle, surfaceHandle, w, h) {
      var m = requireModule();
      m.preinitializedWebGPUDevice = deviceHandle;    // emscripten_webgpu_get_device() reads this
      m.preinitializedWebGPUSurface = surfaceHandle;  // initRendererWebGPU's EM_ASM_INT twin reads this
      app = SDK.createWebApp(m, {
        renderSurface: { kind: 'webgpu', surface: { from: 'injected' } },
        getViewportSize: function () { return { width: w, height: h }; },
      });
      return true;
    },

    // Populate a demo scene of moving sprites.
    spawnDemo: function (n) {
      var world = app.world;
      for (var i = 0; i < n; i++) {
        var e = world.spawn();
        world.insert(e, SDK.Transform, { position: { x: (Math.random() - 0.5) * 2000, y: (Math.random() - 0.5) * 2000, z: 0 } });
        world.insert(e, SDK.Velocity, { linear: { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: 0 } });
        world.insert(e, SDK.Sprite, { size: { x: 16, y: 16 } });
      }
      return n;
    },

    // Advance one frame. Returns app.tick's Promise; the host pumps until it settles, then
    // (rendered mode) presents the swapchain. transform_update mirrors the bench harness.
    tick: function (dt) {
      var m = requireModule();
      var p = app.tick(dt);
      var reg = app.world.getCppRegistry && app.world.getCppRegistry();
      if (reg && m.transform_update) m.transform_update(reg);
      return p;
    },

    // Headless frame-budget bench — ports bench/nojit-frame-bench.mjs into embedded JSC so
    // the Swift host reproduces the 5000-entity 60fps result end to end. Returns a Promise
    // resolving to the timing summary.
    runHeadlessBench: async function (ent, frames, warm) {
      this.createHeadless();
      this.spawnDemo(ent);
      var DT = 1 / 60;
      for (var w = 0; w < warm; w++) await this.tick(DT);
      var samples = new Float64Array(frames);
      for (var f = 0; f < frames; f++) { var t0 = __now(); await this.tick(DT); samples[f] = __now() - t0; }
      var sorted = Array.prototype.slice.call(samples).sort(function (a, b) { return a - b; });
      var median = sorted[Math.floor(frames * 0.5)];
      return {
        entities: ent, frames: frames,
        median: median, p95: sorted[Math.floor(frames * 0.95)], min: sorted[0],
        mean: sorted.reduce(function (a, b) { return a + b; }, 0) / frames,
        pass60: median <= 16.67, pass30: median <= 33.33,
      };
    },
  };
})(globalThis);
