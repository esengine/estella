# REARCH_RENDER：渲染后端现代化（RC7-3 keystone 落地）

> 本文是 `REARCH_FRONTIER.md §RC7` 的展开落地文档，聚焦 **keystone（抬升 `GfxDevice` 抽象）** 及其降险前置（提交路径统一）。
> 目标：把渲染管线从"WebGL2 命令式、GL 概念漏满签名、提交路径碎片化"收敛为 **后端无关的 PipelineState / BindGroup / UBO / 类型化句柄模型**，使 WebGPU 成为纯加法层，且在纯 WebGL2 基线下先落地即有收益。

---

## 0. 横切约束（决定排序，不可绕过）

主战场是 **微信小游戏 + playable**（`build-tools/build.config.js`），WebGL2 是一等公民。由此：

- **WebGPU 不普及 → 必须 WebGL2 回退共存**，不能 all-in；WebGPU 只能是 keystone 之后的纯加法后端。
- **keystone 选取原则**：必须在 **纯 WebGL2 / 单线程基线下先有收益**（UBO 减少 uniform 调用、PSO 消灭每帧字符串查表），而不是为了未来后端才付的成本。
- 凡 web-only 前沿特性（WebGPU、threads、SIMD）一律设计为 **web 优先 + 微信回退**，做加法层而非主线依赖。

---

## 1. 现状评估：已最优的部分（**不要动**）

| 子系统 | 状态 | 证据 |
|---|---|---|
| 排序 / 合批 | ✅ 扎实 | `DrawCommand::buildSortKey` 把 stage/layer/shader/blend/texture/depth 打成 u64（`DrawCommand.hpp:45-69`）；`DrawList::finalize` 把相邻连续 index 合并为单次大 `drawElements`（`DrawList.cpp:18-58`） |
| 瞬时缓冲 | ✅ 合理 | `TransientBufferPool` 按 `LayoutId` 分 VBO/EBO/VAO，规避 `baseVertex` 截断（设计注释 `TransientBufferPool.hpp:20-28`） |
| 资源生命周期 | ✅ 现代 | Buffer/Texture/Shader/Framebuffer 均 RAII（移动语义 + `owns_` 防双删，`Texture.hpp:124-274`） |
| 状态去冗余 | ✅ 有 | `StateTracker` cache-and-compare，消除冗余 GL 状态切换（`StateTracker.cpp`） |
| 设备抽象边界 | ✅ 清晰 | `GfxDevice` 已是抽象接口；**collect 阶段经 `RenderTypePlugin` 已后端无关**——GL 泄漏集中在 `DrawList::execute` 与资源类，边界干净 |

> 结论：这不是重写，是**收敛**。collect 侧不动，主重写点只有 `DrawList::execute` + 资源类。

---

## 2. 病灶（真正缺口，按"是否阻塞后端"分层）

### A. `GfxDevice` 抽象层级过低 —— **阻塞 WebGPU 的根因**
接口自述"一个方法 = 一次 glXxx"（`GfxDevice.hpp:37`）。WebGL 概念漏满签名，这些在 WebGPU **无对应物**：
- VAO 系列：`createVertexArray/bindVertexArray/enableVertexAttrib/vertexAttribPointer`（`GfxDevice.hpp:219-236`）
- 散装 uniform：`getUniformLocation` + `setUniform1i/1f/2f/3f/4f/Mat3/Mat4`（`GfxDevice.hpp:163-188`）
- immediate-bind：`bindVertexBuffer/bindIndexBuffer/bindTexture`（`GfxDevice.hpp:134/204-207`）
- GLSL 源码直传：`createProgram(vertexSrc, fragmentSrc, ...)`（`GfxDevice.hpp:153`）
- 裸 `u32` 资源句柄（全接口）、WebGL-only：`pixelStorei/setUnpackFlipY`（`GfxDevice.hpp:290/298`）

因此现状下**无法新增 `WebGPUDevice : public GfxDevice`**——只有 `GLDevice` 一个实现（`GLDevice.hpp:29`）。

### B. 热路径绕开 uniform 缓存
`DrawList::execute` 每次切 shader 直接 `device.getUniformLocation(cmd.shader_id, "u_projection")` 字符串查表（`DrawList.cpp:71`），**绕开了已存在的 `Shader::uniformCache_`**（`Shader.hpp:224`，`Shader.cpp:179-189` 确实在用，但热路径不走 Shader 类）。对应审计 C5。`ImmediateDraw.cpp:111` 同病。

### C. UBO 完全缺失 —— 散装 uniform
`GfxBufferTarget` 只有 `{Vertex, Index}`（`GfxEnums.hpp`），全仓零 UBO GL 调用。每帧每 shader 切换都重设 `u_projection`，全靠散装 `setUniformMat4`。

### D. 提交路径碎片化（"统一"那一面）
- 5 个 batch 插件（Sprite/UIElement/Text/Particle/Tilemap）各自复制 `emitQuad`/`rotatePoint`/`buildDrawCommand`（约 200 行重复 + 3 处不一致）。
- **ParticlePlugin index winding `{0,1,2,0,2,3}` 与其它 `{0,1,2,2,3,0}` 不一致**（`ParticlePlugin.cpp:14`）。
- Spine 走 **TS pre-flush 回调**（`SpinePlugin.ts`）而非插件 `collect()`——GPU 侧已归一（同 `LayoutId::Batch` + `DrawList`），但 CPU 提交侧是独立路径。
- ImmediateDraw 自持一套 `TransientBufferPool` + `batch_shader_id_`，与 RenderFrame 平行。
- UI/Text/Tilemap blend mode 硬编码 `Normal`，Sprite/Particle 从组件取——不一致。

### E. material cache 死路径
`getMaterialDataWithUniforms` **零调用者**，`material_cache` 仅此处写（`WebSDKEntry.cpp:107-177`）；TS 侧 `invalidateMaterialCache/clearMaterialCache` 沦为对永空 map 的 no-op（审计 B2-4 已确认）。**可删**，且当前没有真正的"材质 = 管线 + 资源绑定"模型。

### F. 死基建（半成品已在仓，留给正交快赢）
- `drawElementsInstanced`（`GfxDevice.hpp:249`）、`vertexAttribDivisor`（`:236`）实现于 GLDevice 但**零调用者**。
- `PARTICLE_INSTANCE_VERTEX/FRAGMENT` 实例化 shader 写好却**零引用**（`Shader.hpp:310-358`）；粒子实走 CPU 逐粒子展开（`ParticlePlugin.cpp:82-149`）。
- `DrawCommand` 支持 8 纹理槽（`DrawCommand.hpp:14`），提交侧只填 `texture_count=1`——不同纹理立即断批。

---

## 3. 目标架构

### 3.1 核心模型（后端无关）

```
PipelineState  ── 不可变对象：program + 顶点布局(VAO 配方) + blend/depth/stencil/cull
BindGroup      ── 资源集合：纹理槽[ ] + UBO 绑定[ ]
FrameUBO       ── per-frame 常量（首发只装 u_projection: mat4）
TypedHandle<T> ── PipelineHandle / BufferHandle / TextureHandle / BindGroupHandle，取代裸 u32
```

`GfxDevice` 新接口形态（草图，命令编码而非 1:1 glXxx）：

```cpp
// 创建期（一次性）
PipelineHandle  createPipeline(const PipelineDesc&);   // shader+layout+blend/depth/stencil 一次绑定
BufferHandle    createBuffer(BufferKind, ...);         // BufferKind 加 Uniform
BindGroupHandle createBindGroup(const BindGroupDesc&); // 纹理+UBO 资源集

// 提交期（DrawList::execute 重写为以下三步）
void setPipeline(PipelineHandle);     // 取代 useProgram + 顶点格式 + blend/depth/stencil 散装设置
void setBindGroup(u32 slot, BindGroupHandle); // 取代散装 bindTexture + setUniform*
void draw(const DrawParams&);         // drawElements / drawElementsInstanced 统一入口
```

WebGL2 后端把 PipelineState 映射为 VAO 配方 + 缓存的 program/blend 状态；UBO 映射为 `glBindBufferBase`。WebGPU 后端则天然 1:1。

### 3.2 关键洞察：batch 路径的 FrameUBO 极小

batch 路径（Sprite/Text/Particle/Tilemap/Spine/UIElement）**已把 transform 烘焙进顶点**，每帧只需 `u_projection`（mat4）+ 每批 `u_texture`。所以：

- **FrameUBO 首发只一个 `mat4 u_projection`**，全帧 bind 一次，**彻底消灭** `DrawList::execute` 每次切 shader 的 `getUniformLocation + setUniformMat4`（病灶 B/C 同时解决）。
- batch / shape shader 改用 `layout(std140, binding=0) uniform Frame { mat4 u_projection; };`（GLES3 核心，零扩展）。
- 后处理的 `u_resolution`/`u_sceneTexture` 后续并入或单列，不影响首发。

### 3.3 边界不变 —— 纯 C++ 重构

TS/WASM 边界对 uniform 布局**不透明**：`renderer_begin(viewProjPtr, target)` 仍传矩阵指针，C++ 内部读 HEAP → 填 FrameUBO。`postprocess_setUniformFloat/Vec4(passName, name, ...)` 仍字符串派发，C++ 内部映射。**无任何导出函数签名变更，TS 侧零改动**（material cache 死函数可顺手删）。

### 3.4 WebGPU 作为加法层（keystone 之后）

抽象抬升后新增 `WebGPUDevice : public GfxDevice` + GLSL→WGSL（Tint/naga，或 `.esshader` 作者语言迁 WGSL）；微信保留 WebGL2 回退（双后端架构天然容纳）。解锁 compute shader（粒子/裁剪 GPU 化）。**不插队**。

---

## 4. 分阶段落地

> 原则：纯加法优先；旧路径保留到迁移完成；每阶段可独立验证、独立提交、独立回滚。

### P0 — 提交路径统一（降险前置，不依赖 keystone）
- 抽 `BatchPlugin` 基类，收编 5 插件的 `emitQuad`/`rotatePoint`/`buildDrawCommand`/winding 常量。
- Spine 提交收进同一 helper（CPU 侧归一；GPU 侧本已统一）。
- 修 ParticlePlugin winding；统一 blend mode 取值口径。
- 修热路径 uniform-cache 旁路（`DrawList.cpp:71` / `ImmediateDraw.cpp:111` 改走缓存 location）。
- **价值**：keystone 重写 `execute` 时需适配的提交面从 6 条降到 1 条。
- **验证**：`tests/renderer/*` + 像素快照不变；draw call 数不变。

### P1 — GfxDevice 加 UBO 能力 + FrameUBO（纯加法，已据证据修正）
- `GfxBufferTarget` 加 `Uniform`；GfxDevice 加 `createBuffer(Uniform)` + `bindUniformBufferBase(point, buffer)` + `getUniformBlockIndex(program, name)` + `uniformBlockBinding(program, idx, point)`（GLDevice 实现 `glBindBufferBase`/`glGetUniformBlockIndex`/`glUniformBlockBinding`）。WebGL2/GLSL ES 3.00 **无 in-shader `binding=` 限定符**，绑定点必须 host 侧 `glUniformBlockBinding` 设。
- `FrameConstants`（std140）首发只 `mat4 u_projection`（64B，单 mat4 无对齐坑）；**一个持久 UBO**，init 创建、`RenderFrame::begin` 每帧 `bufferSubData` 更新一次、绑定点 0 全帧 bind 一次（不走 TransientBufferPool——那是 per-draw 几何流）。
- 活的 shader 只有 **batch + shape** 两个（其余 6 个 .esshader + 内联 EXT_MESH/PARTICLE_INSTANCE 全死，证据见审计/探查）→ 迁移面极小。**注意：batch.esshader 是 GLSL ES 1.00**（`attribute`/`varying`/`texture2D`/`gl_FragColor`），UBO 需 ES 3.00 → batch 必须先升 `#version 300 es`（已有 ES3.00 参照：`Shader.hpp` 的 `BATCH_VERTEX/FRAGMENT` 内联）；shape 已是 ES 3.00。这步并入 RC7-6 的 shader 版本统一。
- **旧散装 `u_projection` 路径保留**给 custom-geometry/material（`GeometryBindings::draw_mesh` 用散装 `u_projection`+`u_model` 在用户 shader 上）——P1 纯加法、不破这些路径。
- **价值（修正）**：纯 WebGL2 的 per-frame uniform 节省 **可忽略**（实测路径每帧仅 1–3 次 `setUniformMat4`，按 shader 切换 gate，非 per-draw——原"显著下降"的说法不成立）。P1 的真实价值是 **(a) 最低风险地落地 UBO/bind 机制**（std140 + host 侧 block-binding + ES 版本升级，孤立可逐像素验证，避免与 P2 的 execute 重写纠缠）、**(b) 前向兼容 P2**（UBO 即 BindGroup 的首个非纹理资源，P1 写的 UBO API 被 P2 复用、非废弃）、**(c) WebGPU 前置形态**（WebGPU 无散装 uniform，全是 UBO/bind group）。
- **验证**：headless `verify:render` 四场景逐像素不变（同 P0）；FrameCapture 对比 draw call 数不变。

### P2 — PipelineState keystone 主体（DONE，实况记录）
分两 checkpoint 落地：
- **P2a（纯加法）**：`PipelineState.hpp`（`PipelineDesc` = program+vertexLayout+blend+depth+`GfxStencilMode`+cull → 缓存为不可变 `PipelineHandle`）；`GfxDevice` 增 `createPipeline`/`setPipeline`/`setStencilReference`/`invalidatePipelineCache`；GLDevice 用 desc 表 + **句柄比较去冗余**（同 pipeline 跳过整组状态应用）实现，stencil 序列镜像旧 StateTracker。`LayoutId` 移到 `GfxEnums.hpp`（叶子头）破除 include 环。
- **P2b（状态归属收敛）**：**重写 `DrawList::execute`** — 每个合并命令解析出 PipelineDesc → `setPipeline` + 动态 scissor/stencilRef/纹理 + draw（一条路径，**删掉 `customDraw` 特例**，shape 变普通 pipeline：program=shape、layout=Shape）。**退役 `StateTracker`**（删 `.hpp/.cpp` + 单测）：GPU 状态归属收归 GLDevice，`pipeline-skip` 替代了它对昂贵 program/blend/stencil 的去冗余，per-draw 动态状态直接应用（sort+merge 已粗粒度分组，几无冗余）。`ImmediateDraw` 迁到单一 pipeline + `setPipeline`；`RenderFrame`/`EstellaContext` 去掉 StateTracker 注入；`invalidatePipelineCache` 在 flush/replay/imm-begin 阶段首调用（防外部直接改 program 后 stale）。删了 RenderFrame 无调用者的 stencil 透传 API。
- **决策**：不采用"双缓存 + 每阶段 resync"的折中（那是补丁）——单一状态归属是最佳架构。`DrawCommand`/`buildSortKey`/`canMergeWith` **保持不变**（现有 key 已按 shader+blend+state+texture 分组 = pipeline 一致的批；execute 在 draw 时解析 handle，用 1-entry memo 跳过排序后连续相同 desc 的查找）。`depthWrite` 保持 on（test off），匹配旧 2D 状态以保像素一致。
- **价值**：单一后端无关命令编码层，`WebGPUDevice` 可作为 `GfxDevice` 子类插入；状态归属单一、无双缓存。
- **验证**：emscripten web 构建链接通过；headless `verify:render` 四场景（含 ui-layout 的 stencil 遮罩）像素与 P0/P1 基线**逐项完全一致**；渲染器单测编译通过。

### P3 — 加法层（独立排期，依赖 P2）
- `WebGPUDevice` 后端 + GLSL→WGSL；微信保 WebGL2 双后端（RC7-4）。
- 后处理 → 小型 render graph + MRT（声明式 pass 图 + transient FBO 复用，`Framebuffer` 加多 color attachment）（RC7-5）。
- shader 变体系统 + 单一来源：扩 `ShaderParser` 支持 feature-keyword permutation；内联 GLSL 收编进 `.esshader`；统一升 `#version 300 es`，删死 shader（RC7-6 / 审计 B1）。

### 正交快赢（任意阶段并行，**不依赖 keystone**，微信直接受益）
- **RC7-1 粒子实例化**：接已写好的 `PARTICLE_INSTANCE` shader + `drawElementsInstanced`/`vertexAttribDivisor`；`DrawCommand` 加 `instance_count`；带宽降 ~75%（病灶 F）。
- **RC7-2 多纹理批合并**：`BatchVertex` 加 texIndex 通道；batch fragment 改 `sampler2DArray`（GLES3 核心）；`DrawList::finalize` 合并放宽到多槽。

---

## 5. Blast radius（精确清单）

| 动 | 不动 |
|---|---|
| `renderer/GfxDevice.hpp`（加 UBO/PSO/BindGroup 接口） | `renderer/RenderFrame.cpp` collect 流程 |
| `renderer/GLDevice.{hpp,cpp}`（实现新接口） | `renderer/DrawCommand.hpp` 排序键 / 合并逻辑 |
| `renderer/DrawList.cpp:60-131`（execute 重写） | `renderer/TransientBufferPool.*`（按 LayoutId 分流） |
| `renderer/Shader.{hpp,cpp}`（uniform→UBO/反射） | `renderer/StateTracker.*` 去冗余（被 PSO 内化但保留） |
| `renderer/ImmediateDraw.cpp`（迁 PSO/UBO） | `renderer/RenderTypePlugin.hpp` collect 接口 |
| `renderer/PostProcessPipeline.cpp`（迁 PSO/UBO） | `bindings/*` 导出签名（边界不变） |
| `renderer/plugins/*`（P0 收编进 BatchPlugin） | `sdk/src/*` TS 渲染层（边界不变） |
| `renderer/GfxEnums.hpp`（加 Uniform target） | |
| 删 `bindings/MaterialCache.hpp` 死路径 | |

---

## 6. 验证方案

- **单元**：`tests/renderer/*`（`MockGfxDevice.hpp` 已有，可断言命令序列）。
- **像素一致性**：`FrameCapture` / `renderer_captureNextFrame` 快照逐阶段对比，保证零回归。
- **性能**：FrameCapture 已记录 draw call（`DrawList.cpp:111-126`）；P1 后对比 uniform 调用数，P2 后对比 draw call 合并率。
- **编辑器端到端**：`verify:render:spine` 等脚本 + 编辑器 viewport 实测。

---

## 7. 风险与回滚

- 每阶段**纯加法优先**：新路径与旧路径并存，验证通过后才删旧路径。
- P0/P1/P2 **可独立提交回滚**；P3 与正交快赢互不阻塞。
- 唯一较大重写是 `DrawList::execute`（约 70 行），blast radius 受控（collect 侧不动）。

---

## 8. 进度

| 阶段 | 状态 |
|---|---|
| 方案文档 | ✅ 本文 |
| P0 提交路径统一 | ✅ DONE（commit e23b1ff5 / 675777a3） |
| P1 FrameConstants UBO + batch ES3.00 | ✅ DONE（commit d80619e7） |
| P2 PipelineState keystone（P2a 抽象 + P2b 状态收敛） | ✅ DONE（P2a commit 1b1bc9c3；P2b 待提交） |
| P3 WebGPU / render graph / shader 变体 | ⬜ OPEN（加法层，依赖 P2） |
| 正交快赢 RC7-1/7-2 | ⬜ OPEN（可并行，不依赖 keystone） |
