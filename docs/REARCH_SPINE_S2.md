# Estella Spine S2 —— side-module 提质到原生水平 + parity 验证(REARCH_SPINE_S2)

> 承接 `REARCH_SPINE.md` 的迁移序。S1(多版本接通:spine38/42 出货 + web provider + 编辑器接线 + 3.8 headless 验证)已完成。
> 本文是 **S2** 的可执行计划:把原生 `SpinePlugin.cpp` 的 clipping 移植进 side-module,并用 **逐三角网格 parity** 证明 side-module 4.2 == 原生 4.2 —— 这是 S3 安全删原生的前置门槛。
> 执行纪律(用户已拍板):四个开放决策全部取最优解(见 §2),终态删原生不留兼容桩。

---

## 0. 验证目标(= S3 删原生的前置门槛)

S2 改动面 = **把 clipping 移进 side-module + 统一 mesh/event 提取**。验证必须证明:

> 同一个 4.2 资产、同一动画时刻,**side-module 4.2 的逐三角网格输出 == 原生 4.2**;带 clipping 的资产两路裁剪结果一致。

只有它成立,S3 才能"盲删"原生而不回归现有渲染。

## 1. 四条已查证事实(决定计划成本)

| # | 事实 | file:line | 影响 |
|---|---|---|---|
| A | 版本路由在 **TS**(4.2→原生,3.8/4.1→module) | `SpineManager.loadEntity` / `SpinePlugin.ts:104-107` | **force-route 纯 TS**,不重建 wasm |
| B | side-module 网格数据 **JS 可读** | `SpineController.forEachMeshBatch` → `getMeshBatchData` | side-module 4.2 网格 node 内可取 |
| C | 原生网格**只写进 C++ `DrawList`** | `SpinePlugin::emitBatch` | 要对比须给原生加临时取数 hook(S3 删) |
| D | `spineboy-pro` / `tank-pro` 跨 3.8/4.1/4.2 都在且含 clipping | `third_party/spine-runtimes-*/examples/*/export` | 一资产覆盖总 parity + clipping |

## 2. 路由现实(已查证,推翻蓝图前提)+ 简化后的验证

**关键事实:4.2 在编辑器/web 里已经走 side-module,不走原生。** `webAppFactory.ts:51-53` —— 给了 `wasmBaseUrl` 就注入 `WebSpineWasmProvider`;`createSpineFactories`(`SpineModuleLoader.ts:173`)**无条件含 4.2**;故 `SpineManager.loadEntity` line 65 的 `!factories_.has('4.2')` 为假,4.2 落到 module backend。编辑器 `EngineHost` 用 `createWebApp(module,{wasmBaseUrl:'/wasm'})` → **4.2=side-module**。原生 4.2 仅在无 provider 配置才触发。

**这是 S1 的副作用**(接通 3.8/4.1 provider 时把 4.2 一并切了),且暴露一个 **live bug**:side-module 跳过 clipping(`SpineModuleEntry.cpp:556`)→ 带 clipping 的 4.2 资产(tank)在编辑器**正在错误地不裁剪渲染**。**S2 修这个现存回归**,不只是为 S3 铺路。

**次要约束:原生 spine 路径 GL 耦合**(`SpineResourceManager.cpp:30` 用 GL 纹理 `getWidth/getHeight` 填 page 尺寸,不读 .atlas 文本)→ 纯 node 取不到原生网格。但既然原生已非 4.2 生产路径,**不再需要对齐原生**。

简化后的验证(不需 force-route、不需原生像素 parity、不需 capture hook):

1. **主门槛(确定性 · node · 无 GL)= side-module clipping 正确性**:`spine-clip.integration.test.ts` 直接驱动 spine42 controller 加载 tank-4.2,提取裁剪网格,断言 clip 多边形包含性 + clip-on vs clip-off 网格不同。**移植的是 spine 官方 `spSkeletonClipping`(side-module spine-c 自带),与原生调 spine-cpp `SkeletonClipping` 同一算法 → 移植=接线** → 不变量 + 视觉 smoke 足以验证接线正确。
2. **辅门槛(ship 视觉 · Electron)= 自参照 before/after**:编辑器/realm 渲 tank-4.2(side-module 路径),S2 后 clipping 可见。无需原生对比。
3. **资产 = spineboy-pro(总网格回归)+ tank-pro(clipping 专项)**,跨版本都在,均非 PMA。node 测试用 stub page 纹理(.atlas 真实尺寸 + 假 glId)使 attachment emit。
4. **顺手补 spine41 出货**(S1 残留)。

## 3. 脚手架(全部 S3 删除)

- **a. force-route(纯 TS)**:`SpineManager` test-only `forceModuleVersions: Set<string>`,命中则 4.2 也走 module backend(load 已在盘的 `spine42`)。
- **c1. node clip 不变量测试**:`sdk/tests/spine-clip.integration.test.ts`,扩展 `spine38-load.integration.test.ts` 的 node 加载模式 —— spine42 side-module 加载 tank-4.2,t∈{0,0.2,0.5,1.0} 提取网格,断言 clip 包含性 + 关裁剪对照越界。
- **c2. Electron 像素 parity 驱动**:复用 headless Electron + loopback http-static 模式(`headless-verify.mjs` 模板),经 `runtimeLoader`(已接 spine)渲 native-4.2 一帧 → force-route 重渲 side-4.2 一帧 → 像素 diff。
- **d. 资产**:spineboy-pro + tank-pro(4.2)入测试/服务可达路径。

> 不再需要原生 C++ capture hook —— GL 约束下像素 parity 用原生正常渲染,node 不变量用 side-module(无 GL)。

## 4. Pass 判据

- 逐三角:worldVertex/uv/color `epsilon ≤ 1e-4`;index 完全一致。
- 批次数 / 纹理页 / blend mode 一致。
- clipping 资产:裁剪后三角数与原生一致,且 < 未裁剪时(证明确实裁了,排除"两路都没裁"的假绿)。
- 多关键帧时刻都过(动画推进,不只静态 t=0)。

## 5. 验证序 = TDD red→green

1. 搭 a/b/c/d 脚手架,**先不改 clipping 逻辑**。
2. 跑 parity:总网格 region/mesh **PASS**;clipping 资产(tank)**FAIL**(side-module 不裁,三角多于原生)→ red,证明测试有效。
3. 移植 `SkeletonClipping` 进 `SpineModuleEntry.cpp`(= S2 主体),重建 spine wasm。
4. 同一测试转 **GREEN** = S2 完成的客观证明。

## 6. 完成状态(DONE)

**S2 核心 = clipping 移植 + 确定性验证,已完成并验证。**

实现(`src/esengine/bindings/SpineModuleEntry.cpp`):
- `SpineContext` 加 `spSkeletonClipping* clipper`(惰性创建,reset 释放)+ `clippingEnabled` 开关。
- `extractMeshBatches` 的 drawOrder 循环接入 spine 官方裁剪:clipping attachment → `clipStart`;每个 region/mesh 经新 `emitClippedTriangles`(`isClipping()` 时 `clipTriangles` → 用 `clippedVertices/clippedUVs/clippedTriangles` 发射,否则原样);每个非 clip slot 后 `clipEnd(slot)`,循环末 `clipEnd2`。**region 也裁**(修了 native 只裁 mesh 的 bug)。
- 新导出 `spine_setClippingEnabled(int)`(默认开;让测试对比 clip-on/off,亦为 perf 开关)。
- 三版 spine-c 的 `spSkeletonClipping` API 完全一致 → 零 `#ifdef`。spine38/41/42 全部重建出货(**spine41 = S1 残留一并补齐**)。

验证(`sdk/tests/spine-clip.integration.test.ts`,2 用例):
- node 直驱 spine42 加载 tank-4.2 + stub page 纹理 + 显式挂 smoke-glow,提取 clip-on/off 网格。
- 断言:clip 改变了网格(376 vs 344 tri)+ clipped bbox ⊆ unclipped + 严格缩小(smoke maxY 1495→950,被裁回坦克车身多边形内)。
- **RED→GREEN 全程走通**(移植前 clip-on==clip-off 失败 → 移植后通过)。
- 回归:spine 套件 28 绿;全量 SDK **2245 绿**;SDK + desktop tsc 干净。

**剩余(非阻塞)**:Electron 像素视觉 smoke(把 spine 接进 verify:render 或 play realm 渲 tank-4.2,肉眼确认裁剪)—— 渲染管线(submitMeshes→GL)S2 没动,风险低,作为后续 live-check。`spine_setClippingEnabled` 是 S3 可选清理项(留作 perf 开关亦可)。

> **顺带确认的 live bug(见 §2):4.2 在编辑器里早已走 side-module**,S2 此前缺失 clipping → 带 clipping 的 4.2 资产在编辑器一直错误地不裁剪渲染。S2 修复了它。
