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
// string in the host can do: the TextDecoder / TextEncoder shims, and the default entry points.

// The platform layer decodes packaged JSON through TextDecoder; QuickJS has none,
// so route it to the host's UTF-8 decoder. Only utf-8 is meaningful here.
globalThis.TextDecoder = function TextDecoder() {};
globalThis.TextDecoder.prototype.encoding = 'utf-8';
globalThis.TextDecoder.prototype.decode = function (buf) {
    return buf == null ? '' : es_utf8Decode(buf);
};

// Its other half, which neither engine ships either (V8 and QuickJS are languages;
// TextEncoder is the browser's): a game encoding a protocol message or a save as
// UTF-8 bytes stopped at "TextEncoder is not defined" on a device. Plain JS — the
// WHATWG algorithm, a lone surrogate becoming U+FFFD as it does in a browser.
if (typeof globalThis.TextEncoder !== 'function') {
    var utf8Into = function (str, out, at) {
        var n = str.length;
        for (var i = 0; i < n; i++) {
            var c = str.charCodeAt(i);
            if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
                var d = str.charCodeAt(i + 1);
                if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
                else c = 0xfffd;
            } else if (c >= 0xd800 && c <= 0xdfff) {
                c = 0xfffd;
            }
            if (c < 0x80) {
                if (out) out[at] = c;
                at += 1;
            } else if (c < 0x800) {
                if (out) { out[at] = 0xc0 | (c >> 6); out[at + 1] = 0x80 | (c & 63); }
                at += 2;
            } else if (c < 0x10000) {
                if (out) { out[at] = 0xe0 | (c >> 12); out[at + 1] = 0x80 | ((c >> 6) & 63); out[at + 2] = 0x80 | (c & 63); }
                at += 3;
            } else {
                if (out) {
                    out[at] = 0xf0 | (c >> 18); out[at + 1] = 0x80 | ((c >> 12) & 63);
                    out[at + 2] = 0x80 | ((c >> 6) & 63); out[at + 3] = 0x80 | (c & 63);
                }
                at += 4;
            }
        }
        return at;
    };
    globalThis.TextEncoder = function TextEncoder() {};
    globalThis.TextEncoder.prototype.encoding = 'utf-8';
    globalThis.TextEncoder.prototype.encode = function (input) {
        var str = input === undefined ? '' : String(input);
        var out = new Uint8Array(utf8Into(str, null, 0));
        utf8Into(str, out, 0);
        return out;
    };
    globalThis.TextEncoder.prototype.encodeInto = function (input, dest) {
        var bytes = this.encode(input);
        var written = Math.min(bytes.length, dest.length);
        // Never half a character: back off to the last whole one that fits.
        while (written > 0 && written < bytes.length && (bytes[written] & 0xc0) === 0x80) written--;
        dest.set(bytes.subarray(0, written));
        var read = 0, w = 0;
        for (var i = 0; i < String(input).length && w < written; i++) {
            var c = String(input).charCodeAt(i);
            var size = c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? 4 : 3;
            if (w + size > written) break;
            w += size;
            read += size === 4 ? 2 : 1;
            if (size === 4) i++;
        }
        return { read: read, written: written };
    };
}

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
            if (e && e.stack) console.error(e.stack);
        });
};
globalThis.update = function (dt) {
    if (globalThis.__esGame) globalThis.__esGame.app.tick(dt);
};
