// Demo game — pure game logic, loaded at runtime as a packaged asset (the APK's
// assets/ on Android, the app bundle on iOS; NOT compiled into the C++ host).
// It authors through the real SDK exactly like a web
// game: ESEngine.createNativeApp + world.spawn/insert + the Input and Assets
// resources. The host provides `ESEngine` (SDK bundle), the `es_*` globals, the
// frame constants W/H/S, and the platform bridge `__esNativeBridge`.
//
// A sprite follows the touch; a shape orbits — proof the real App runs on device.

var app, world, input, follower, orbit, t = 0.0;

function init() {
    app = ESEngine.createNativeApp(globalThis.__esNativeBridge, globalThis);
    app.tick(0);                       // sync through finishPlugins: binds input + inserts Input
    world = app.world;
    input = app.getResource(ESEngine.Input);
    var assets = app.getResource(ESEngine.Assets);

    // The frame belongs to the SDK here, exactly as on the web: a Canvas gives the
    // design resolution and the clear colour, a Camera gives the projection. The
    // host no longer decides either — it presents what this camera renders.
    var stage = world.spawn();
    world.insert(stage, ESEngine.Canvas, {
        designResolution: { x: W, y: H }, scaleMode: 2 /* Expand */,
        backgroundColor: { r: 0.07, g: 0.08, b: 0.12, a: 1 } });

    var camera = world.spawn();
    world.insert(camera, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.5, z: 0 } });
    world.insert(camera, ESEngine.Camera, {
        projectionType: 1 /* orthographic */, orthoSize: H * 0.5, isActive: true, clearFlags: 3 });

    // Fallback 2x2 checker (a tiny inline texture) while the real image loads.
    // Nearest filter + clamp (format 1, no flip, filter 0, wrap 1) so the scaled-up
    // pixels stay crisp — the same import-settings path a cooked pixel-art texture
    // takes, exercised on every boot.
    var tex = es_createTexture(2, 2, [
        255, 0, 0, 255,    0, 255, 0, 255,
        0, 0, 255, 255,    255, 255, 0, 255 ], 1, false, 0, 1);

    follower = world.spawn();
    world.insert(follower, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.5, z: 0 } });
    world.insert(follower, ESEngine.Sprite, {
        texture: tex, color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: S * 0.28, y: S * 0.28 } });

    // Load logo.png through the REAL SDK asset pipeline — the SAME Assets API a web
    // game uses. Assets.loadTexture decodes the image via the platform
    // (bridge.loadImagePixels) and uploads it through the native ResourceManager,
    // returning a tracked handle. No hand-rolled es_createTexture: the demo now
    // exercises the unified asset channel, not a bespoke native texture path.
    assets.loadTexture('logo.png').then(function (result) {
        world.insert(follower, ESEngine.Sprite, {
            texture: result.handle, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: S * 0.28, y: S * 0.28 } });
    }, function (err) {
        console.error('logo.png failed to load:', err && err.message ? err.message : err);
    });

    orbit = world.spawn();
    world.insert(orbit, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.75, z: 0 } });
    world.insert(orbit, ESEngine.ShapeRenderer, {
        shapeType: 0, color: { r: 1, g: 0.2, b: 0.9, a: 1 }, size: { x: S * 0.12, y: S * 0.12 } });

    // Stage: a KTX2 compressed texture through the SAME Assets API. The host
    // transcodes it (basis) to a device-supported format (ASTC/ETC2) and uploads
    // the compressed blocks — no WebGL2, no wasm transcoder.
    var ktx2Sprite = world.spawn();
    world.insert(ktx2Sprite, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.28, z: 0 } });
    assets.loadTexture('green.ktx2').then(function (res) {
        world.insert(ktx2Sprite, ESEngine.Sprite, {
            texture: res.handle, color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: S * 0.24, y: S * 0.24 } });
        console.log('[demo] ktx2: loaded ' + res.width + 'x' + res.height + ' handle=' + res.handle);
    }, function (e) {
        console.error('[demo] ktx2 failed:', e && e.message ? e.message : e);
    });

    // Stage C: a startup chime through the REAL SDK Audio API. The native audio
    // backend decodes beep.wav and plays it in the host's miniaudio engine — the
    // audio pillar on device, the same Audio API a web game calls.
    var audio = ESEngine.Audio && app.getResource(ESEngine.Audio);
    if (audio) {
        audio.playTrack('beep.wav', { volume: 0.4 }).then(function (h) {
            console.log('[demo] audio: ' + (h
                ? 'playing (isPlaying=' + h.isPlaying + ', duration=' + h.duration.toFixed(2) + 's)'
                : 'null handle — no native audio backend'));
        }, function (e) {
            console.error('[demo] audio failed:', e && e.message ? e.message : e);
        });
    } else {
        console.log('[demo] audio: no Audio resource');
    }

    // Stage: text through the SAME `Text` component a web game authors. The host
    // rasterizes each glyph from the OS font stack (there is no 2D canvas here)
    // and the SDK's glyph atlas, layout and batching do the rest — including the
    // per-codepoint font fallback that makes the CJK line resolve.
    var label = world.spawn();
    world.insert(label, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.62, z: 0 } });
    world.insert(label, ESEngine.Text, {
        content: 'Estella 原生文本', fontSize: S * 0.075, align: 1,
        color: { r: 1, g: 0.92, b: 0.4, a: 1 } });

    // Stage: prove native networking — es_fetch over NSURLSession/OkHttp, TLS by
    // the OS. The async reply lands back on the JS thread via the frame loop.
    globalThis.__esNativeBridge.fetch('https://example.com').then(function (r) {
        var bytes = r.arrayBuffer ? r.arrayBuffer.byteLength : (r.text ? r.text.length : 0);
        console.log('[demo] fetch: ok=' + r.ok + ' status=' + r.status + ' bytes=' + bytes);
    }, function (e) {
        console.error('[demo] fetch failed:', e && e.message ? e.message : e);
    });
}

function update(dt) {
    t += dt;
    app.tick(dt);                      // run the App loop (host pumps its async jobs)
    // Follow the touch once there's been one (host touch is top-left origin; the
    // world is y-up). Before any touch, the logo sits centered.
    var p = input.getMousePosition();
    if (p.x !== 0 || p.y !== 0) {
        world.insert(follower, ESEngine.Transform, { position: { x: p.x, y: H - p.y, z: 0 } });
    }
    world.insert(orbit, ESEngine.Transform, {
        position: { x: W * 0.5 + Math.cos(t * 1.2) * S * 0.3, y: H * 0.75, z: 0 } });
}
