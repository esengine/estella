// Demo game — pure game logic, loaded at runtime from the APK's assets/ (NOT
// compiled into the C++ host). It authors through the real SDK exactly like a web
// game: ESEngine.createNativeApp + world.spawn/insert + the Input resource. The
// host provides `ESEngine` (SDK bundle), the `es_*` globals, the frame constants
// W/H/S, and the platform bridge `__esNativeBridge`.
//
// A sprite follows the touch; a shape orbits — proof the real App runs on device.

var app, world, input, follower, orbit, t = 0.0;

function init() {
    es_setClear(0.07, 0.08, 0.12);
    app = ESEngine.createNativeApp(globalThis.__esNativeBridge, globalThis);
    app.tick(0);                       // sync through finishPlugins: binds input + inserts Input
    world = app.world;
    input = app.getResource(ESEngine.Input);

    // Fallback 2x2 checker while the real image decodes.
    var tex = es_createTexture(2, 2, [
        255, 0, 0, 255,    0, 255, 0, 255,
        0, 0, 255, 255,    255, 255, 0, 255 ]);

    follower = world.spawn();
    world.insert(follower, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.5, z: 0 } });
    world.insert(follower, ESEngine.Sprite, {
        texture: tex, color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: S * 0.28, y: S * 0.28 } });

    // Load a REAL image (logo.png) from the APK through the SDK platform
    // (NativeBridge.loadImagePixels), decoded by the host with stb_image, and swap
    // it onto the follower — proving the native image-decode -> texture path.
    globalThis.__esNativeBridge.loadImagePixels('logo.png').then(function (img) {
        var logo = es_createTexture(img.width, img.height, img.pixels);
        world.insert(follower, ESEngine.Sprite, {
            texture: logo, color: { r: 1, g: 1, b: 1, a: 1 }, size: { x: S * 0.28, y: S * 0.28 } });
    });

    orbit = world.spawn();
    world.insert(orbit, ESEngine.Transform, { position: { x: W * 0.5, y: H * 0.75, z: 0 } });
    world.insert(orbit, ESEngine.ShapeRenderer, {
        shapeType: 0, color: { r: 1, g: 0.2, b: 0.9, a: 1 }, size: { x: S * 0.12, y: S * 0.12 } });
}

function update(dt) {
    t += dt;
    app.tick(dt);                      // run the App loop (host pumps its async jobs)
    // Follow the touch once there's been one (Android touch is top-left origin; the
    // world is y-up). Before any touch, the logo sits centered.
    var p = input.getMousePosition();
    if (p.x !== 0 || p.y !== 0) {
        world.insert(follower, ESEngine.Transform, { position: { x: p.x, y: H - p.y, z: 0 } });
    }
    world.insert(orbit, ESEngine.Transform, {
        position: { x: W * 0.5 + Math.cos(t * 1.2) * S * 0.3, y: H * 0.75, z: 0 } });
}
