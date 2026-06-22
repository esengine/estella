# Estella 能力前沿现代化方案（Capability Frontier Re-architecture）

> 目标读者：引擎维护者 / AI 协作代理。
> 本文是 `REARCHITECTURE.md` 的**续篇**，体例一致：描述目标架构与根治路径，而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`（2026-06 全仓只读审计，4 路并行 + 交叉印证）。
> **与 RC1–RC6 的区别**：
> - RC1–RC5 根治**正确性根因**（多源真相、可绕过抽象、存储/身份/错误模型）。
> - RC6 根治**资产/平台能力错配**（压缩纹理、内容寻址、显存预算、分包流式）。
> - 本文（RC7–RC11）根治**能力前沿错配**：引擎在 RC1–RC6 后将"功能正确、地基干净"，但其**性能上限、渲染后端、数据驱动深度、编辑器协议、联网能力**仍停在"能跑"而非"最先进"。这不是 bug，是**未建立的能力**——区别于 RC1–RC5 的"已建立但有缺陷"。

---

## 0. 核心诊断：一条横切约束 + 一片能力空白

### 0.1 横切约束（决定所有排序）：主战场是微信小游戏 + playable

构建目标以 `wechat` / `playable` 为一等公民（`build-tools/build.config.js:21-128`）。这条现实约束**否决了"按技术新潮排序"**：

- **WebGPU**：微信小游戏端支持不普及 → 必须 WebGL2 回退共存，不能 all-in。
- **wasm threads（`-pthread`/SharedArrayBuffer）**：微信环境 SAB 受限、需 COOP/COEP 头 → 需双构建分叉，不能作为默认。
- **Wasm SIMD（`-msimd128`）**：旧机型/旧 WebView 支持不全 → 需 no-SIMD 回退构建。

**原则**：凡涉及 web-only 前沿特性者，一律设计为 **web 优先 + 微信回退共存**；keystone 优先选那些"在 WebGL2 / 单线程基线下就有收益"的改造，让前沿特性成为纯加法的升级层，而非主线依赖。

### 0.2 能力空白：RC1–RC6 未触及的五个维度

| 维度 | RC1–RC6 状态 | 本文 |
|---|---|---|
| 渲染后端 | 纯 WebGL2，零 WebGPU；管线命令式、无 render graph、无实例化 | **RC7** |
| ECS 执行性能 | 调度信息齐备但单线程串行、零 SIMD（主模块）、math 纯标量 | **RC8** |
| 数据驱动 / 反射深度 | 反射刻意停在 ABI 层，富元数据从未存活到 TS | **RC9** |
| 编辑器 ↔ 运行时协议 | 无版本化协议，进程内 mutate 单例；热重载全量丢状态 | **RC10** |
| 网络复制 / 多人 | 概念完全为零 | **RC11** |

**根治原则**：每条主线先找到**在基线下就有收益的 keystone**，把前沿特性挂成它之上的加法层；凡半成品已在仓者（实例化粒子、变体系统、prefab 迁移框架）优先**激活而非新建**。

---

## RC7：渲染后端现代化

### 病灶
- **后端纯 WebGL2/GLES3，零 WebGPU**：全 7 套构建配置写死 `-sUSE_WEBGL2=1 -sFULL_ES3=1`（`cmake/Emscripten.cmake`，各档）。`GfxDevice.hpp:4` 注释口头提到 "WebGPU/Vulkan" 但**仅 `GLDevice` 一个实现**（`GLDevice.hpp:29`）。
- **实例化是死代码**：`GfxDevice::drawElementsInstanced`（`GfxDevice.hpp:249`）、`vertexAttribDivisor`（`:236`）已实现于 `GLDevice` 但**零调用者**；`PARTICLE_INSTANCE_VERTEX/FRAGMENT` 实例化 shader（`Shader.hpp:310-358`）写好却**零引用**。粒子实走 CPU 逐粒子展开 4 顶点 + sin/cos 旋转（`ParticlePlugin.cpp:82-149`），WASM 单线程下每帧重建整个顶点流。
- **多纹理批能力闲置**：`DrawCommand` 支持 8 纹理槽（`DrawCommand.hpp:14`），`DrawList::execute` 已能多槽绑定，但提交侧只填 `texture_count=1`（`RenderFrameSubmit.cpp:49`、`ParticlePlugin.cpp:159`）——**不同纹理立即断批**。
- **GfxDevice 抽象层级过低**：接口是 "一个方法 = 一次 glXxx" 的瘦封装（`GfxDevice.hpp:37` 自述 1:1）。WebGL 概念漏满签名——VAO（`:220-236`）、散装 `glUniform*`（`:170-188`）、immediate-bind（`:204-213`）、GLSL 源码直传（`:153-155`）、裸 `u32` 资源句柄、WebGL-only 枚举（`pixelStorei`/`setUnpackFlipY`，`:290/298`）。这些在 WebGPU 里**无对应物**，故现状下无法新增 `WebGPUDevice : public GfxDevice`。
- **无 render graph / 无 MRT**：管线命令式 collect→sort→merge→flush（`RenderFrame.cpp`）；`RenderStage` 仅 4 固定档（`RenderStage.hpp`），非可声明 pass 图；后处理是线性 ping-pong FBO 链（`PostProcessPipeline.hpp:230-231`），全仓 `drawBuffers`/`COLOR_ATTACHMENT1` 零命中。
- **shader 变体系统闲置 + 来源分裂**：`#pragma variant` 解析存在（`ShaderParser.cpp:194-225`）但 8 个 `.esshader` 一个没用，运行期变化全靠 uber-shader 的 uniform int 分支（`ui.esshader:24-26`）；GLSL 两套来源（`.esshader` 文件 + `Shader.hpp`/`PostProcessPipeline.cpp:24-48` 内联字符串）；存在 ES1.0/ES3.0 混用与 `EXT_MESH_*` 老语法残留（`Shader.hpp:242-272`）。

> **亮点（不动）**：排序/合并做得扎实——`DrawCommand::buildSortKey` 把 stage/layer/shader/blend/texture/depth 打成 u64（`DrawCommand.hpp:45-69`），`DrawList::finalize` 相邻连续 index 合并为单次大 `drawElements`（`DrawList.cpp:18-58`）；`TransientBufferPool` 按 `LayoutId` 分 VBO 解决 baseVertex 截断；collect 阶段经 `RenderTypePlugin` 接口**已后端无关**——GL 泄漏集中在 `DrawList::execute` 与资源类，边界清晰。

### 目标架构
1. **激活实例化（纯加法，半成品已在仓）**：`DrawCommand` 加 `instance_count` 字段 + instanced 分支；`ParticlePlugin` 改走 per-instance 数据流（pos/size/rotation/color/uv），4 顶点 quad + divisor，接上已写好的 `PARTICLE_INSTANCE` shader。带宽降 ~75%，CPU 顶点重建开销大降。
2. **多纹理批合并**：`BatchVertex` 加 texIndex/texLayer 通道；`DrawList::finalize` 合并放宽到多槽；batch fragment shader 改 `sampler2DArray`（GLES3 核心，零扩展）。多图集/字体场景 draw call 显著下降。
3. **抬升 GfxDevice 抽象（keystone）**：把 §病灶列的 GL 泄漏收敛为后端无关模型——`PipelineState`（shader + 顶点布局 + blend/depth/stencil 不可变对象）、`BindGroup`（资源集合）、命令编码、UBO 替代散装 uniform、类型化资源句柄。**主重写点是 `DrawList::execute`（`DrawList.cpp:60-131`）**；collect 阶段不动。**在纯 WebGL2 下先落地即有收益（UBO 减少 uniform 调用）。**
4. **WebGPU 后端（加法层，依赖 3）**：抽象抬升后新增 `WebGPUDevice : public GfxDevice` + GLSL→WGSL 翻译（Tint/naga，或把 `.esshader` 作者语言迁 WGSL）；微信保留 WebGL2 回退（双后端架构天然容纳）。解锁 compute shader（粒子/裁剪 GPU 化）。
5. **后处理 → 小型 render graph + MRT**：pass 链改声明式（输入/输出资源 + 依赖），调度器分配/复用 transient FBO；`Framebuffer` 加多 color attachment（GLES3 核心 `drawBuffers`）。
6. **shader 变体系统 + 单一来源**：扩 `ShaderParser` 支持 feature-keyword permutation（编译期 `#define` 注入 + 变体缓存）；内联 GLSL 收编进 `.esshader`；统一升 `#version 300 es`，删 ES1.0 回退与 `PARTICLE_INSTANCE` 之外的死 shader。

> keystone = 第 3 步：它是 WebGPU（4）、UBO、未来任何后端的唯一前置，且基线下先落地就有收益。第 1/2/6 步与之正交，可先行。

---

## RC8：ECS 执行性能

### 病灶
- **两套 ECS 并存**：C++ 核心是存储层（每组件一个分页 `SparseSet<T>`，`SPARSE_PAGE_SIZE=4096`，`SparseSet.hpp:149`）；SDK 里另有一套**完整 Bevy 式 TS 用户态 ECS**（schedule/query/command-buffer/change-detection），是游戏逻辑实际编写与调度处（`app.ts:689-809`）。
- **调度器有信息却不并行**：系统已声明读写集（`Mut` = 写、`Query`/`Res` = 读，`system.ts:52-60`），`sortSystems()` 做拓扑排序 + 环检测（`app.ts:689-767`），但执行是单 for 循环串行 `await`（`app.ts:803`）——**只排序、不做冲突分析、零并行**。
- **零多线程**：全仓 `std::thread`/`pthread`/`SharedArrayBuffer`/`Atomics` 零命中；link flags 无 `-pthread`/`-sUSE_PTHREADS`（`Emscripten.cmake` 全档单线程）。
- **SIMD 仅物理侧**：`-msimd128` 只在 Box2D side-module（`Emscripten.cmake:368-378`），主模块/渲染/spine 不开；`src/` 无 `<wasm_simd128.h>`/`v128_t`。
- **math 纯标量**：`Math.hpp:20-28` 只设 `GLM_FORCE_RADIANS` 等，**无任何 `GLM_FORCE_SSE*/NEON/SIMD/DEFAULT_ALIGNED`** → GLM 走标量默认实现；TransformSystem 的 mat4 乘法逐分量标量。
- **C++ 侧延迟很初级**：`View::each` 用整池 `std::vector` 快照拷贝容忍迭代内增删（`View.hpp:273-274`）——每帧每查询一次堆分配；延迟逻辑散落（`TweenSystem.cpp:72` 手搓 pending、`Signal.hpp` pendingAdds），无统一 command buffer 抽象。

> **亮点（不动）**：SDK 侧 command buffer（`commands.ts`，系统结束自动 flush）、变更检测（`ChangeTracker.ts` 按 tick）、`RemovedQuery`、`SystemSet`/`runIf` 已是相当现代的特性集。

### 目标架构
1. **SIMD math（低风险独立，keystone-low）**：`Math.hpp` 开 GLM SIMD 后端 + `GLM_FORCE_DEFAULT_ALIGNED_GENTYPES`；主模块 + 渲染热路径加 `-msimd128`（物理侧已验证可用）；微信出 no-SIMD 回退构建。**关键 caveat**：开对齐会改组件 struct 布局，而零拷贝靠 `ptrLayouts.generated.ts` 固定偏移——必须重新生成偏移表，**RC1 的 ABI hash 握手 + `static_assert(offsetof)` 正是这个改动的安全网**（改错即启动拒绝/编译失败）。
2. **自动并行调度**：用已声明的读写集构建系统冲突图，把拓扑序升级为"按组件读写冲突分组并行批次"（Bevy 式）。**先在单线程上做冲突分析 + 确定性验证**（拿到收益且为并行铺路）；真并行作为加法层依赖第 4 步。
3. **C++ 统一 command buffer**：把散落的延迟逻辑收敛为单一 deferred 抽象，消除 `View::each` 每帧快照分配，并为并发结构变更提供单一安全入口；语义对齐 SDK `CommandsInstance`。
4. **wasm threads 工作线程池（加法层，受平台约束）**：`Emscripten.cmake` 加 `-pthread -sUSE_PTHREADS -sPROXY_TO_PTHREAD -sSHARED_MEMORY`，解锁数据并行（变换层级、粒子）；微信因 SAB 受限走双构建。**高风险，排在最后。**

> **存储模型已拍板**：**不上 archetype**（会推翻 RC2 的"单一 SparseSet"统一计划 + 破坏 `ptrLayouts` 稳定指针契约）。如需固定组合的连续遍历，做 EnTT owning-group（增量维护交集连续布局，与 RC2 兼容），不做全量 archetype 重构。

---

## RC9：数据驱动 / 反射深化

### 病灶
- **反射刻意停在 ABI 层**：`ES_COMPONENT`/`ES_PROPERTY` 是**空宏**（`Reflection.hpp:35,56`），反射靠 EHT 正则解析（`tools/eht/parser.py`）。注解白名单仅 5 个（asset/animatable/anim_override/entity_ref/readonly，`parser.py:102`）。
- **富编辑器元数据全缺**：无 range/step/slider、无 tooltip、无 DisplayName、无真分组（category 退化为组件名）、无 hidden、无网络复制标记。
- **富元数据从未存活到 TS（关键）**：C++ 侧生成了 `editor_getComponentSchema` JSON（`editor_api.py`），但**TS 侧零消费**；`component.generated.ts` 的 `COMPONENT_META` 只带值 + 轻量标签（defaults/assetFields/entityFields/colorFields/animatableFields），全文件无 min/max/step/tooltip/label/category。
- **scene 迁移无框架**：prefab 迁移是**真·版本化、幂等**的（`prefab/migrate.ts`，`PREFAB_FORMAT_VERSION`，加载自动应用）——很好；但 scene 迁移是散落硬编码命令式特例（`scene.ts:156-179,267-282`），`version:'1.0'` 字段**写了从不读分支**（死字段），无"格式版本过新即拒绝"守卫。
- **TS 用户组件是二等公民**：`animatableFields` 恒空、colorKeys 靠 `detectColorKeys` 启发式（`component.ts:236-249`），元数据形状与 C++ builtin 不同构。

> **亮点（不动）**：prefab 的 8 种 override / 嵌套 / 变体 / diff / 校验是 **Unity 级**；资产引用 = 稳定 UUID GUID（`.meta` 旁挂、改名不破引用、`AssetRegistry` 双 map）；ABI 三重握手（组件方法存在性 + 自报组件表 + layout hash，`BuiltinBridge.ts:385-438`）。弱点集中在 **scene 格式本身**（冗长美化 JSON、无二进制、无 delta）。

### 目标架构
1. **富元数据单一权威源（keystone）**：给 `ES_PROPERTY` 扩注解词汇（`range=`/`step=`/`tooltip=`/`label=`/`category=`/`hidden`/`replicated`/`skip_serialize`），在 `parser.py` 透传，从 `MetadataGenerator` 发到 TS `COMPONENT_META`（而非只进 C++ 的 `editor_getComponentSchema`）。**一处注解，三处受益**：带约束的精修 inspector + 声明式序列化策略 + 网络复制声明（RC11 前置）。
2. **序列化版本迁移框架**：把 `prefab/migrate.ts` 的版本化幂等模式提升为通用框架套到 scene；让 serializer 写真版本号、loader 按版本分支、加"版本过新即拒绝"守卫。
3. **TS 用户组件与 builtin 同构**：`defineComponent` 扩为 schema-builder（字段级 `f.float({min,max}).tooltip()`），让纯 TS 组件进同一 inspector/序列化/复制管线，元数据形状与 EHT 产出对齐。

> keystone = 第 1 步：它是 RC9 第 3 步、RC10 inspector、RC11 复制声明的共同杠杆。`ES_PROPERTY` 当前是空宏，扩它是纯加法。

---

## RC10：编辑器 ↔ 运行时协议

### 病灶
- **无版本化、类型化协议**：编辑器与运行时同 JS realm，靠**直接 mutate 共享单例** `AppContext.editorBridge`（`context.ts:56`）+ 观察者回调（`EditorBridge`，`context.ts:18-38`）接入，无握手、无信封、无版本戳；`postMessage`/`rpc`/`jsonrpc` 全仓零命中。
- **同步是隐式文件布局契约**：`syncToDesktop` 纯 `fs.cp` 拷贝（`build-tools/tasks/sync.js:7-44`），无 manifest、无版本戳；唯一"类型化"部分是 bundle 里的 `.d.ts`。
- **热重载全量丢状态**：`PreviewPlugin.reloadScene()`（`preview/PreviewPlugin.ts:191-201`）= `SceneManager.switchTo('__preview__')` 整场景拆毁重建、重 fetch JSON、重载所有资产，**不保留任何实体/组件状态**；`runtimeLoader.ts` 是一次性加载器，无增量路径。SSE 服务器不在本仓（仅见客户端 `EventSource` 连 `/sse-reload`）。

### 目标架构
1. **版本化命令/事件契约**：把隐式接缝（`EditorBridge`、`inputRouter.setEditorHandler`、`transaction.ts`、SSE）收敛为显式 `attachEditor(version, bridge)` 握手 + editor→runtime 编辑命令 schema（复用 `commands.ts` 命令类型）+ runtime→editor 变更事件信封；同步产物打协议版本戳。为未来 out-of-process / 远程编辑铺路。
2. **状态保留热重载 / 场景 live-patch**：借 `prefab/diff.ts:49` 的 diff 思路做 scene-diff → 增量 apply（insert/remove/setField），保留运行时状态；World 已有 `ChangeTracker` + ECS 重映射（`scene.ts:132-150`）可复用。调参体验从"重载丢状态"升级到"改字段立即生效"。

> 注：编辑器源码在仓外，改契约需跨仓协调——这是 RC10 的主要约束，故契约设计须先行、向后兼容。

---

## RC11：网络复制 / 多人

### 病灶
- **复制层完全为零**："replication" 概念全仓不存在；`net/GameSocket.ts` 仅有 socket 传输，无权威/插值/relevancy/RPC。

### 目标架构
- **从反射生成复制层（复用 RC9 + 已有 ptr 布局）**：基于 RC9 第 1 步的 `replicated`/`authority` 注解，从 EHT 生成 per-component 增量序列化器——**复用 `ptrLayouts.generated.ts`（本身已是紧凑二进制表示）做 binary diff**，与 RC9 第 2 步的 binary delta 序列化共享底层；运行时补权威/插值/relevancy。
- **战略定位**：工作量最大；若产品路线图含多人则为战略缺口，否则暂缓。其杠杆点在于"反射注解 + ptr 布局"已铺好底座，不必从零造轮子。

---

## 附：工具链小改进（非引擎架构，顺手）

- **收敛 8 套重复 flag 集合**：`Emscripten.cmake` 各 target 手工重复 link flags 易漂移 → 抽公共基集 + 差异叠加（`es_emscripten_flags()` 或 `list(APPEND)`），逐 target 验证产物字节级一致。低风险纯重构。
- **EHT 去正则**：`parser.py` 正则解析 C++ 头对模板/宏脆弱 → 迁 libclang AST（保留 Python，只换解析内核）。
- **wasm-split 懒加载**：对主 `esengine.wasm` 用 profile-guided `wasm-split`，把编辑器专用/post-process/tilemap 冷代码切二级模块，首屏只下主块；`ES_ENABLE_*` 特性开关天然是切分边界。微信/playable 首包体积 KPI。
- **CMake generator 换 Ninja**（emsdk 已自带）。

## 尊重的既定取舍（不改）

经独立复核，以下决定正确，**本文不建议改动**：
- `-fno-exceptions` + 显式状态码（保留，省体积/速度）。
- Memory64（2D 引擎用不上 4GB 上限，纯 ~10-20% 性能/体积税）。
- archetype（不如 owning-group，且冲突 RC2）。

---

## 执行顺序（按"微信/playable 主战场 + ROI"排，全程保持构建常绿，每批可独立验证）

| 档位 | 批次 | 依据 |
|---|---|---|
| **立即（独立 / 低风险 / 见效快）** | RC7-1 实例化粒子、RC7-2 多纹理批、RC8-1 SIMD math、RC7-6 shader 死代码清理+统一来源、RC9-2 scene 迁移框架、工具链 flag 收敛 | 均不依赖大重构；微信端立竿见影；半成品已在仓者优先激活 |
| **keystone（解锁后续）** | RC7-3 GfxDevice 抽象抬升、RC9-1 富反射元数据单一源 | 两个总闸门，WebGL2/基线下即有收益，各自解锁一整条上层 |
| **中长期（依赖前置 + 平台权衡）** | RC7-4 WebGPU、RC8-2/4 自动并行 + wasm threads、RC11 网络复制、RC10-2 状态保留热重载、RC10-1 规范化协议 | 依赖 keystone 或受微信平台约束需回退共存 |

> 依赖序：RC7-3 是 RC7-4 的唯一前置；RC9-1 是 RC9-3 / RC10 inspector / RC11 复制声明的共同前置；RC8-2 的真并行依赖 RC8-4；RC11 依赖 RC9-1 + RC9-2。
> 核心判断：**先吃 RC7-1/7-2/8-1 三个低垂果实（天级、纯加法、微信直接受益），同时把 RC7-3 与 RC9-1 两个 keystone 立项。WebGPU 性感但不插队。**

---

## 验证机制（与 RC1 keystone 同精神：机制即根治成立的证明）

- **RC7 渲染**：实例化前后**逐像素回归**（同场景渲染结果一致，仅 draw call/带宽下降）；GfxDevice 抽象抬升用既有 `MockGfxDevice` harness 守护接口契约；多纹理批的合并正确性用 draw call 计数断言。
- **RC8 SIMD/并行**：SIMD math 用标量/向量化**逐 bit 对拍**关键变换；自动并行的冲突图用"同冲突集系统永不并行"断言 + 确定性回放测试；`ptrLayouts` 重生成后由 ABI hash 握手 + `static_assert(offsetof)` 守门。
- **RC9 反射**：富元数据**端到端往返**（注解 → `COMPONENT_META` → inspector 渲染）；scene 迁移框架的幂等性 + "版本过新即拒绝" 测试（仿 `prefab/migrate.ts`）。
- **RC10 协议**：`attachEditor` 版本协商测试；scene live-patch 的 diff→apply 与全量重载结果一致性对拍。
- **RC11 网络**：复制序列化往返（编码→解码逐字段一致）；权威/插值确定性测试。

---

## 需要拍板的架构岔路

| 岔路 | 选项 A | 选项 B（推荐） |
|---|---|---|
| **渲染后端路线** | 直接上 WebGPU 双后端 | **先抬升 GfxDevice 抽象（RC7-3），WebGL2 下落地 UBO/PSO 收益；WebGPU 作为其后的加法层** |
| **并行执行后端** | 立即引入 wasm threads | **先做单线程冲突分析 + 确定性（RC8-2），threads 作为受平台约束的加法层（RC8-4）** |
| **固定组合查询优化** | 全量 archetype 重构 | **EnTT owning-group（增量交集连续布局，兼容 RC2 单一 SparseSet）** |
| **scene 格式** | 维持美化 JSON | **保留 JSON 为可读源 + 加版本迁移框架（RC9-2）；二进制/delta 作为发布期可选编码** |
| **RC11 启动时机** | 与 RC9 并行立即做 | **待产品确认多人路线后启动；底座（RC9-1 注解 + ptr 布局）先于其就位** |

---

## 实现进度（living status）

- **RC9-2（scene 序列化版本迁移框架）：✅ 已落地（2026-06-19）**，作为编辑器 play 态隔离（`RC12_EDITOR_SEAM.md` E4-3）的前置先行：`scene.ts` 新增版本化、幂等、非变异的 `migrateSceneData`（读版本 + 过新即拒绝 + 盖版本），散落硬编码迁移收编，`loadSceneData` 不再变异输入，并以组件 codec 注册表解除 scene↔tilemap 耦合。全 SDK 套件 2161 passed。详见 RC12 living status。
- **其余 RC7–RC11：📋 已立项（设计文档）**，尚未开始执行。
- 建议首个执行批次：RC7-1（实例化粒子，半成品已在仓，纯加法，验证成本低）作为切入点，同步启动 RC7-3 / RC9-1 两个 keystone 的详细根治方案文档。
