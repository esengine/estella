// The host bootstrap — HOST code, not game code. Embedded into the binary at
// build time (build-tools/tasks/native.js writes host_bootstrap.h), the way the
// SDK bundle is, and evaluated right after it.
//
// A real .js file rather than a C++ string literal: it is JavaScript, so it should
// be lintable, highlightable and diffable as JavaScript.
//
// Deliberately small. The bridge itself is assembled by the SDK
// (createHostBridge) from the es_* primitives the host binds — typed there
// against the interface it must satisfy — so what is left here is only what a JS
// string in the host can do: the TextDecoder shim, and the default entry points.

// The platform layer decodes packaged JSON through TextDecoder; QuickJS has none,
// so route it to the host's UTF-8 decoder. Only utf-8 is meaningful here.
globalThis.TextDecoder = function TextDecoder() {};
globalThis.TextDecoder.prototype.decode = function (buf) {
    return buf == null ? '' : es_utf8Decode(buf);
};

// The whole host contract in one check — the JS globals a bare engine lacks and
// the es_* bindings this shell binds — so a gap is named here, not downstream.
ESEngine.assertNativeHost(globalThis);

// The bridge over the host's es_* bindings; it also installs es_onNativeTouch,
// the entry point the host calls per touch.
globalThis.__esNativeBridge = ESEngine.createHostBridge(globalThis);

// Boot an EXPORTED project: game.config.json, the manifests, the cooked assets
// and the scenes, all read off the device. This is the only way in — a packaged
// game always comes from the editor.
globalThis.__esGame = null;
globalThis.init = function () {
    ESEngine.initNativeGame({ bridge: globalThis.__esNativeBridge, scope: globalThis, width: W, height: H })
        .then(function (game) { globalThis.__esGame = game; })
        .catch(function (e) {
            console.error('exported game failed to boot:', e && e.message ? e.message : e);
        });
};
globalThis.update = function (dt) {
    if (globalThis.__esGame) globalThis.__esGame.app.tick(dt);
};
