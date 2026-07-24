// Minimal JS-engine environment shims so the emscripten (ENVIRONMENT=web/shell) glue
// runs under a bare embedded JSC context with no DOM and no browser globals. Evaluated
// FIRST, before the engine glue and the SDK bundle. The host (EstellaHostKit) injects
// the native primitives __print / __now and drains g.__pump each run-loop turn.
(function (g) {
  g.console = { log: __print, warn: __print, error: __print, info: __print, debug: __print };
  g.performance = g.performance || { now: __now };

  // setTimeout / clearTimeout backed by a queue the host drains via g.__pump each tick —
  // emscripten's async wasm instantiation schedules its continuation through setTimeout.
  var timers = [], nextId = 1;
  g.setTimeout = function (fn, ms) { var id = nextId++; timers.push({ id: id, fn: fn, at: __now() + (ms || 0) }); return id; };
  g.clearTimeout = function (id) { for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); break; } };
  g.setImmediate = function (fn) { return g.setTimeout(fn, 0); };
  g.__pump = function () {
    var now = __now();
    for (var i = 0; i < timers.length;) {
      if (timers[i].at <= now) { var t = timers.splice(i, 1)[0]; try { t.fn(); } catch (e) { __print('timer error: ' + (e && e.stack || e)); } }
      else i++;
    }
  };

  // atob: emscripten's SINGLE_FILE glue decodes an embedded wasm data-URI with it. The
  // native relink (ENVIRONMENT=shell, EXPORT_ES6=0) feeds wasm as bytes instead, so this
  // is a safety net rather than a hot path.
  var TBL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  g.atob = g.atob || function (s) {
    s = String(s).replace(/=+$/, ''); var out = '';
    for (var bc = 0, bs = 0, buf, i = 0; (buf = s.charAt(i++));) {
      buf = TBL.indexOf(buf); if (buf < 0) continue;
      bs = bc % 4 ? bs * 64 + buf : buf;
      if (bc++ % 4) out += String.fromCharCode(255 & bs >> (-2 * bc & 6));
    }
    return out;
  };
})(globalThis);
