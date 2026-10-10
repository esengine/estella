// SPDX-License-Identifier: Apache-2.0
import { setPlatform, webAdapter } from '../sdk/src/platform';
import { CanvasGlyphRasterizer } from '../sdk/src/ui/text/glyph-rasterizer';
import { GlyphAtlas } from '../sdk/src/ui/text/glyph-atlas';
import { SdfTextRenderer, type DrawTextParams } from '../sdk/src/ui/text/text-renderer';
import { setNativeTextSubmit } from '../sdk/src/ui/text/submit';

setPlatform(webAdapter);
const root = document.getElementById('root')!;
root.innerHTML = `<style>
body{margin:0;background:#15181e;color:#e3e8ef;font:14px system-ui}main{max-width:1050px;margin:auto;padding:28px}
h1{font-size:22px}p{line-height:1.7;color:#bac3d1}button{padding:9px 18px;background:#307ed4;color:white;border:0;border-radius:6px;cursor:pointer}
button:disabled{opacity:.5}table{border-collapse:collapse;width:100%;margin-top:22px}th,td{text-align:left;padding:12px;border-bottom:1px solid #333d4d}
th{color:#9db2cc}details{margin-top:24px}pre{white-space:pre-wrap;word-break:break-all;font-size:11px}
</style><h1>2D 文字缓存 · CPU 对照</h1>
<p>同一浏览器、同一批 200 个中英文标签。比较缓存开启与每帧清空布局缓存；字形图集在计时前预热。
每项 10 轮 × 10 帧，交替执行顺序。表中统计的是每批平均帧耗时的中位数/P95，非单帧尾延迟。
计时包含缓存键、布局与几何、提交接口；不包含 GPU、WASM 拷贝或 Yoga 重排。</p>
<button id="run">运行对照</button><p id="status" role="status">等待运行</p>
<table><thead><tr><th>更新比例</th><th>每帧重建 批均帧中位 / P95 ms</th><th>缓存开启 批均帧中位 / P95 ms</th><th>中位比值</th><th>几何一致</th></tr></thead><tbody id="rows"></tbody></table>
<details><summary>原始数据与运行环境</summary><pre id="raw"></pre></details>`;
const run = document.getElementById('run') as HTMLButtonElement;
const status = document.getElementById('status')!;
const labels = 200, rounds = 10, frames = 10;
const transform = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const empty = new Set<number>();
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

function harness() {
  let page = 0;
  // Actual Canvas rasterization and SDK atlas/layout/cache; in-memory page store
  // deliberately excludes GPU uploads. Never install this sink in a game realm.
  const atlas = new GlyphAtlas(new CanvasGlyphRasterizer(null, { sdf: false, renderSize: 24 }),
    { createPage: () => ++page, uploadSubRegion: () => {} }, { sdf: false, pageSize: 1024 });
  const renderer = Object.assign(Object.create(SdfTextRenderer.prototype), {
    atlas, sdf: false, module: null, cache_: new Map(),
  }) as SdfTextRenderer;
  const params = Array.from({ length: labels }, (_, i): DrawTextParams => ({
    text: `设置 Settings ${i} 音量 Volume 0123456789`, fontFamily: 'Arial', fontSizePx: 24,
    color: [1, 1, 1, 1], boxWidth: 320, boxHeight: 64, maxWidth: 320,
  }));
  return { renderer, params };
}

run.onclick = async () => {
  run.disabled = true;
  document.getElementById('rows')!.replaceChildren();
  const results: unknown[] = [];
  const cached = harness(), rebuilt = harness();
  let submissions = 0, vertices = 0;
  setNativeTextSubmit((_v, count) => { submissions++; vertices += count; });
  const draw = (h: ReturnType<typeof harness>, changed: number, frame: number, clear: boolean) => {
    if (clear) h.renderer.retainOnly(empty);
    for (let i = 0; i < labels; i++) {
      const base = h.params[i];
      h.renderer.drawText(i < changed ? { ...base, text: `${base.text} ${frame % 2}` } : base, transform, i, 0, 0);
    }
  };
  try {
    await document.fonts.ready;
    for (const rate of [0, 0.01, 0.1, 1]) {
      status.textContent = `正在测量 ${rate * 100}% 标签更新…`;
      const changed = Math.round(labels * rate);
      // Prewarm both text variants and JIT before collecting paired samples.
      for (let f = 0; f < 10; f++) { draw(cached, changed, f, false); draw(rebuilt, changed, f, true); }
      const samples = { cached: [] as number[], rebuilt: [] as number[] };
      for (let round = 0; round < rounds; round++) {
        await tick();
        for (const kind of round % 2 ? ['cached', 'rebuilt'] as const : ['rebuilt', 'cached'] as const) {
          const start = performance.now();
          for (let f = 0; f < frames; f++) draw(kind === 'cached' ? cached : rebuilt, changed, f, kind === 'rebuilt');
          samples[kind].push((performance.now() - start) / frames);
        }
      }
      // Exact geometry comparison outside timing, including every vertex/index.
      const capture = (h: ReturnType<typeof harness>, clear: boolean) => {
        const batches: unknown[] = [];
        setNativeTextSubmit((v, count, indices, _texture, _transform, entity) => batches.push({ entity, count,
          vertices: Array.from(v), indices: Array.from(indices) }));
        draw(h, changed, 1, clear);
        return JSON.stringify(batches);
      };
      const equal = capture(cached, false) === capture(rebuilt, true);
      setNativeTextSubmit((_v, count) => { submissions++; vertices += count; });
      if (!equal) throw Error('Cached and rebuilt geometry differ');
      const c = percentile(samples.cached, .5), b = percentile(samples.rebuilt, .5);
      results.push({ rate, samples, cachedMedian: c, rebuiltMedian: b, geometryEqual: equal });
      const row = document.createElement('tr');
      row.innerHTML = `<td>${rate * 100}% (${changed}/${labels})</td><td>${b.toFixed(3)} / ${percentile(samples.rebuilt, .95).toFixed(3)}</td><td>${c.toFixed(3)} / ${percentile(samples.cached, .95).toFixed(3)}</td><td>${(b / c).toFixed(2)}×</td><td>通过</td>`;
      document.getElementById('rows')!.append(row);
    }
    document.getElementById('raw')!.textContent = JSON.stringify({ schema: 1, labels, rounds, frames,
      userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, dpr: devicePixelRatio,
      date: new Date().toISOString(), submissions, vertices, results, statistic: 'median and nearest-rank P95 of 10 batch-average frame times',
      scope: 'CPU geometry/cache only; warm Canvas bitmap atlas; no GPU/WASM/Yoga; not historical before/after or device acceptance' }, null, 2);
    status.textContent = '完成：4 项几何对照一致。性能数字仅适用于本次环境，无自动速度门槛。';
  } catch (error) { status.textContent = `失败：${String(error)}`; }
  finally { setNativeTextSubmit(null); run.disabled = false; }
};
