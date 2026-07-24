// WebGPU bridge PROBE (not a renderer). A recursive logging Proxy stands in for the JS
// WebGPU API (navigator.gpu + the GPUDevice object graph). Running the REAL engine against
// it captures the exact sequence of WebGPU JS methods the emdawnwebgpu glue invokes on JSC
// — the empirical spec the native Dawn backend (DawnGPUProvider) must implement, and proof
// that emdawnwebgpu accepts a host-injected JS device outside a browser (REARCH_NATIVE.md
// §3.3.2). It renders nothing; every leaf is a no-op that logs its call.
(function (g) {
  var seen = {};
  function note(sig) { if (!seen[sig]) { seen[sig] = 1; __print('[wgpu] ' + sig); } }

  function probe(path) {
    var fn = function () {};
    return new Proxy(fn, {
      get: function (_t, prop) {
        if (prop === 'then') return undefined;                    // must not look thenable
        if (prop === Symbol.toPrimitive) return function () { return 1; }; // numeric/string coercion
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'queue') return probe(path + '.queue');
        if (prop === 'mapState') return 'unmapped';
        if (prop === 'label') return path;
        return probe(path + '.' + String(prop));
      },
      apply: function (_t, _this, args) {
        var name = path.replace(/\(\)/g, '');                     // collapse call-chain noise
        note(name + '(' + args.length + ')');
        if (/getPreferredCanvasFormat$/.test(path)) return 'bgra8unorm';
        if (/getContext$/.test(path)) return probe('context');
        if (/querySelector$/.test(path)) return probe('canvas');
        if (/[Rr]equest|Async$/.test(path)) return Promise.resolve(probe(path + '()'));
        return probe(path + '()');
      },
    });
  }

  // Install the browser-shaped WebGPU environment a bare JSC lacks.
  g.__installWebGPUProbe = function () {
    g.navigator = g.navigator || {};
    g.navigator.gpu = probe('navigator.gpu');
    g.document = g.document || { querySelector: function () { return probe('canvas'); } };
    g.__wgpuProbeDevice = probe('device');
    __print('[wgpu] probe installed (navigator.gpu + document + injected device)');
    return g.__wgpuProbeDevice;
  };
})(globalThis);
