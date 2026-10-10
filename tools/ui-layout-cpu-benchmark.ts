// SPDX-License-Identifier: Apache-2.0
import { App } from '../sdk/src/app/app';
import { Canvas, Transform } from '../sdk/src/ecs/component';
import { UINode } from '../sdk/src/ui/core/ui-node';
import { FlexContainer } from '../sdk/src/ui/layout/flex';
import { UILayoutPlugin } from '../sdk/src/ui/layout/layout';
import { px } from '../sdk/src/ui/core/dimension';
import type { CppRegistry, ESEngineModule } from '../sdk/src/wasm';

document.getElementById('root')!.innerHTML = `<style>
body{background:#15181e;color:#e3e8ef;font:14px system-ui;margin:0}main{max-width:1080px;margin:auto;padding:28px}
h1{font-size:22px}p{color:#bac3d1;line-height:1.7}button{padding:9px 18px;border:0;border-radius:6px;background:#307ed4;color:white}button:disabled{opacity:.5}
table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:12px;text-align:left;border-bottom:1px solid #333d4d}pre{white-space:pre-wrap;word-break:break-all;font-size:11px}
</style><h1>2D 布局 · WASM CPU 对照</h1>
<p>1 个 Canvas、20 个 Flex 行、400 个控件。比较正常 dirty 信号和每次强制属性刷新；两者都保留 Yoga 节点。
计时包括控件写入和一次 uiLayout_update，不含完整 App 帧、Transform pass、文字、渲染或 GPU。
10 轮 × 20 次更新，交替顺序。中位/P95 来自批次平均更新耗时，非单帧尾延迟。</p>
<button id="run">运行对照</button><p id="status" role="status">等待运行</p>
<table><thead><tr><th>更新比例</th><th>强制刷新 中位/P95 ms</th><th>正常 dirty 中位/P95 ms</th><th>全部节点布局</th></tr></thead><tbody id="rows"></tbody></table>
<details><summary>原始数据与 WASM 版本</summary><pre id="raw"></pre></details>`;
const run = document.getElementById('run') as HTMLButtonElement;
const status = document.getElementById('status')!;
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const rounds = 10, frames = 20, controls = 400;

run.onclick = async () => {
  run.disabled = true;
  document.getElementById('rows')!.replaceChildren();
  document.getElementById('raw')!.textContent = '';
  let app: App | null = null, registry: CppRegistry | null = null;
  try {
    status.textContent = '加载真实 WASM…';
    const wasmEntry = '/__layout-wasm/esengine.js';
    const { default: factory } = await import(/* @vite-ignore */ wasmEntry);
    const module = await factory() as ESEngineModule;
    const build = await (await fetch('/__layout-build.json')).json();
    app = App.new(); registry = new module.Registry() as unknown as CppRegistry;
    app.connectCpp(registry, module); app.addPlugin(new UILayoutPlugin());
    const world = app.world;
    const all: number[] = [], leaves: number[] = [];
    const spawn = (parent: number | null, data: Record<string, unknown>) => {
      const e = world.spawn(); all.push(e);
      world.insert(e, Transform, {}); world.insert(e, UINode, data);
      if (parent !== null) world.setParent(e, parent);
      return e;
    };
    const root = spawn(null, { position: 1, width: px(800), height: px(600) });
    world.insert(root, Canvas, {}); world.insert(root, FlexContainer, { direction: 1 });
    for (let row = 0; row < 20; row++) {
      const parent = spawn(root, { width: px(760), height: px(26), flexShrink: 0 });
      world.insert(parent, FlexContainer, { direction: 0, gap: { x: 6, y: 0 } });
      for (let column = 0; column < 20; column++) leaves.push(spawn(parent, { width: px(20), height: px(20), flexShrink: 0 }));
    }
    const solve = (changed: number, frame: number, force: boolean) => {
      for (let i = 0; i < changed; i++) world.insert(leaves[i], UINode, {
        ...world.get(leaves[i], UINode), width: px(frame % 2 ? 22 : 20),
      });
      module.uiLayout_update!(registry!, -400, -300, 400, 300, force || changed > 0);
    };
    const read = () => all.map(e => {
      const t = registry!.getTransform(e);
      return { w: module.getUINodeComputedWidth!(registry!, e), h: module.getUINodeComputedHeight!(registry!, e),
        x: t.position.x, y: t.position.y };
    });
    const results: unknown[] = [];
    for (const rate of [0, .01, .1, 1]) {
      status.textContent = `正在测量 ${rate * 100}% 控件更新…`;
      const changed = Math.round(controls * rate);
      for (let f = 0; f < 20; f++) { solve(changed, f, false); solve(changed, f, true); }
      const samples = { normal: [] as number[], forced: [] as number[] };
      for (let round = 0; round < rounds; round++) {
        await tick();
        for (const mode of round % 2 ? ['normal', 'forced'] as const : ['forced', 'normal'] as const) {
          const start = performance.now();
          for (let frame = 0; frame < frames; frame++) solve(changed, frame, mode === 'forced');
          samples[mode].push((performance.now() - start) / frames);
        }
      }
      let maxDifference = 0;
      // Both variants must agree for every node, not only the edited leaves.
      for (const frame of [0, 1]) {
        solve(changed, frame, false); const normal = read();
        solve(changed, frame, true); const forced = read();
        for (let i = 0; i < all.length; i++) for (const key of ['w', 'h', 'x', 'y'] as const)
          maxDifference = Math.max(maxDifference, Math.abs(normal[i][key] - forced[i][key]));
        if (changed && Math.abs(normal[all.indexOf(leaves[0])].w - (frame % 2 ? 22 : 20)) > .001)
          throw Error('Changed width did not apply');
      }
      if (!Number.isFinite(maxDifference) || maxDifference > .001) throw Error('Layout comparison failed');
      const n = percentile(samples.normal, .5), f = percentile(samples.forced, .5);
      results.push({ rate, changed, samples, normalMedian: n, forcedMedian: f, maxDifference });
      const row = document.createElement('tr');
      row.innerHTML = `<td>${rate * 100}% (${changed}/${controls})</td><td>${f.toFixed(3)} / ${percentile(samples.forced, .95).toFixed(3)}</td><td>${n.toFixed(3)} / ${percentile(samples.normal, .95).toFixed(3)}</td><td>${all.length} 节点一致</td>`;
      document.getElementById('rows')!.append(row);
    }
    document.getElementById('raw')!.textContent = JSON.stringify({ schema: 1, controls, nodes: all.length, rounds, frames,
      date: new Date().toISOString(), build, userAgent: navigator.userAgent, dpr: devicePixelRatio,
      statistic: 'median/nearest-rank P95 of batch-average update times', results,
      scope: 'actual WASM layout update + UINode writes; retained Yoga nodes in both; no full App/Transform/text/GPU; not historical before/after' }, null, 2);
    status.textContent = '完成：四种更新比例、两个尺寸状态的全部节点布局一致。';
  } catch (error) { status.textContent = `失败：${String(error)}`; }
  finally {
    if (app && registry) { for (const e of app.world.getAllEntities()) app.world.despawn(e);
      app.world.disconnectCpp(); (registry as unknown as { delete(): void }).delete(); }
    run.disabled = false;
  }
};
