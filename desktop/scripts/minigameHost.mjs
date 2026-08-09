// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  minigameHost.mjs — the page that boots a mini-game package outside its vendor.
 *
 * A WeChat/Douyin package is CommonJS plus a `wx`/`tt` global, so no browser
 * opens one and CI never launched a mini-game build at all. This supplies both,
 * over http, from the export directory as it shipped.
 *
 * What it is NOT: WeChat. It cannot answer how the real base library behaves.
 * What it does answer is everything between "the exporter returned ok" and "the
 * game runs" — a file the entry requires and the package does not carry, a wasm
 * the loader cannot locate, an entry wired to the wrong boot call.
 *
 * The shim implements `MiniGameGlobal` (sdk/src/platform/minigame/api.ts), which
 * the engine documents as "only the subset the engine actually uses" — so it is
 * written against a declared contract rather than guessed, and check-minigame-host
 * fails when the contract grows a member the shim has not got.
 */

/** The page source; `BASE` is substituted with the served root. */
export const HOST_PAGE = (entry) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  canvas{display:block}
</style></head><body>
<script>
(() => {
  const log = (m) => console.log('[minigame] ' + m);
  // Vendor contract: the FIRST createCanvas() hands back the on-screen canvas and
  // every call after it is offscreen scratch. Hand the engine a fresh offscreen
  // one instead and the game runs perfectly, drawing where nobody can see.
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = window.innerWidth;
  screenCanvas.height = window.innerHeight;
  document.body.appendChild(screenCanvas);
  let screenTaken = false;
  const makeCanvas = () => {
    if (!screenTaken) { screenTaken = true; return screenCanvas; }
    return document.createElement('canvas');
  };

  const readAsArrayBuffer = (p) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', p, false); // sync: readFileSync is synchronous by contract
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr.send(null);
    if (xhr.status !== 200 && xhr.status !== 0) throw new Error('no such file: ' + p);
    const s = xhr.responseText;
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b.buffer;
  };
  const readAsText = (p) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', p, false);
    xhr.send(null);
    if (xhr.status !== 200 && xhr.status !== 0) throw new Error('no such file: ' + p);
    return xhr.responseText;
  };

  const fs = {
    readFileSync: (p, enc) => (enc === 'utf8' || enc === 'utf-8' ? readAsText(p) : readAsArrayBuffer(p)),
    readFile: (o) => {
      try { o.success && o.success({ data: fs.readFileSync(o.filePath, o.encoding) }); }
      catch (e) { o.fail && o.fail({ errMsg: String(e) }); }
      finally { o.complete && o.complete(); }
    },
    accessSync: (p) => { readAsArrayBuffer(p); },
    access: (o) => {
      try { fs.accessSync(o.path); o.success && o.success(); }
      catch (e) { o.fail && o.fail({ errMsg: String(e) }); }
      finally { o.complete && o.complete(); }
    },
    writeFile: (o) => { o.fail && o.fail({ errMsg: 'read-only host' }); o.complete && o.complete(); },
    writeFileSync: () => { throw new Error('read-only host'); },
    mkdirSync: () => {},
    unlinkSync: () => {},
    rmdirSync: () => {},
    readdirSync: () => [],
    statSync: () => ({ size: 0, isDirectory: () => false }),
  };

  const noop = () => {};
  const wx = {
    createCanvas: makeCanvas,
    createImage: () => new Image(),
    getFileSystemManager: () => fs,
    getSystemInfoSync: () => ({
      pixelRatio: window.devicePixelRatio || 1,
      language: 'en',
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      platform: 'devtools',
      safeArea: { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth,
                  width: window.innerWidth, height: window.innerHeight },
    }),
    request: (o) => {
      fetch(o.url).then(async (r) => {
        const data = o.responseType === 'arraybuffer' ? await r.arrayBuffer() : await r.text();
        o.success && o.success({ data, statusCode: r.status });
      }).catch((e) => o.fail && o.fail({ errMsg: String(e) })).finally(() => o.complete && o.complete());
    },
    // Audio and sockets are stubs on purpose: a launch smoke asks whether the
    // package starts and draws, and a silent stub cannot fake either answer.
    createInnerAudioContext: () => ({
      play: noop, pause: noop, stop: noop, destroy: noop, seek: noop,
      onPlay: noop, onPause: noop, onStop: noop, onEnded: noop, onError: noop, onCanplay: noop,
      offPlay: noop, offPause: noop, offStop: noop, offEnded: noop, offError: noop, offCanplay: noop,
      src: '', loop: false, volume: 1, autoplay: false, currentTime: 0, duration: 0, paused: true,
    }),
    connectSocket: () => ({
      send: noop, close: noop,
      onOpen: noop, onClose: noop, onError: noop, onMessage: noop,
      offOpen: noop, offClose: noop, offError: noop, offMessage: noop,
    }),
    onTouchStart: noop, onTouchMove: noop, onTouchEnd: noop,
    offTouchStart: noop, offTouchMove: noop, offTouchEnd: noop,
    onTouchCancel: noop, offTouchCancel: noop,
    // Keyboard: forwarded from the real DOM so a driven run can reach the game.
    onKeyDown: (cb) => window.addEventListener('keydown', (e) => cb({ code: e.code, key: e.key })),
    onKeyUp: (cb) => window.addEventListener('keyup', (e) => cb({ code: e.code, key: e.key })),
    offKeyDown: noop, offKeyUp: noop,
    onMemoryWarning: noop, offMemoryWarning: noop,
    onError: noop, offError: noop,
    onUnhandledRejection: noop, offUnhandledRejection: noop,
    onShow: noop, onHide: noop, offShow: noop, offHide: noop,
    onWindowResize: noop, offWindowResize: noop,
    loadSubpackage: (o) => { o.success && o.success(); o.complete && o.complete(); },
    // Storage is real (localStorage), not a stub: a game that saves on boot and
    // reads it back would otherwise take the silent path and look fine.
    getStorageSync: (k) => { const v = localStorage.getItem(k); return v === null ? '' : JSON.parse(v); },
    setStorageSync: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    removeStorageSync: (k) => localStorage.removeItem(k),
    getStorageInfoSync: () => ({ keys: Object.keys(localStorage), currentSize: 0, limitSize: 10240 }),
    setPreferredFramesPerSecond: noop,
    triggerGC: noop,
    exitMiniProgram: noop,
    getLaunchOptionsSync: () => ({ scene: 1001, query: {} }),
  };
  // WeChat instantiates wasm from a PACKAGE-RELATIVE PATH, not bytes — the one
  // place the vendors genuinely diverge (sdk/src/platform/wechat/wasm.ts), and
  // the reason a browser cannot open one of these packages unaided.
  const asUrl = (p) => '/' + (String(p)[0] === '/' ? String(p).slice(1) : String(p));
  globalThis.WXWebAssembly = {
    instantiate: (pathOrBytes, imports) => (typeof pathOrBytes === 'string'
      ? fetch(asUrl(pathOrBytes)).then((r) => r.arrayBuffer())
        .then((b) => WebAssembly.instantiate(b, imports))
      : WebAssembly.instantiate(pathOrBytes, imports)),
    compile: (p) => fetch(asUrl(p)).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
    Memory: WebAssembly.Memory,
    Table: WebAssembly.Table,
    Module: WebAssembly.Module,
    Instance: WebAssembly.Instance,
  };

  globalThis.wx = wx;
  globalThis.GameGlobal = globalThis;
  globalThis.canvas = screenCanvas;

  // The package is CommonJS. A mini-game host resolves relative requires against
  // the requiring file, so the loader has to carry that directory with it.
  const modules = new Map();
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
  const normalize = (p) => {
    const out = [];
    for (const part of p.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  };
  function requireFrom(dir, spec) {
    let file = spec.startsWith('.') ? normalize(dir + spec) : normalize(spec);
    if (!/\\.(js|json)$/.test(file)) file += '.js';
    if (modules.has(file)) return modules.get(file).exports;
    const src = readAsText('/' + file);
    if (file.endsWith('.json')) {
      const m = { exports: JSON.parse(src) };
      modules.set(file, m);
      return m.exports;
    }
    const mod = { exports: {} };
    modules.set(file, mod);
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', 'wx', 'GameGlobal',
      src + '\\n//# sourceURL=' + file);
    fn(mod, mod.exports, (s) => requireFrom(dirOf(file), s), file, dirOf(file), wx, globalThis);
    return mod.exports;
  }

  try {
    log('booting ${entry}');
    requireFrom('', './${entry}');
    log('entry returned');
  } catch (e) {
    console.error('[minigame] boot failed: ' + (e && e.stack ? e.stack : e));
  }
})();
</script></body></html>`;

/**
 * Members of `MiniGameGlobal` the shim above provides. Kept beside it so
 * check-minigame-host can hold the two against the SDK's declaration.
 */
export const SHIM_MEMBERS = [
  'createCanvas', 'createImage', 'getFileSystemManager', 'request',
  'createInnerAudioContext', 'connectSocket', 'getSystemInfoSync',
  'onTouchStart', 'onTouchMove', 'onTouchEnd',
  'offTouchStart', 'offTouchMove', 'offTouchEnd',
  'onTouchCancel', 'offTouchCancel',
  'onKeyDown', 'onKeyUp', 'offKeyDown', 'offKeyUp',
  'loadSubpackage', 'onMemoryWarning', 'offMemoryWarning',
  'onError', 'offError', 'onUnhandledRejection', 'offUnhandledRejection',
  'onShow', 'onHide',
  'getStorageSync', 'setStorageSync', 'removeStorageSync', 'getStorageInfoSync',
];
