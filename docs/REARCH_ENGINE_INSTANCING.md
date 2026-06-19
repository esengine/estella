# Estella 引擎实例化（Engine Instancing）—— 从"单例引擎"到"实例引擎"

> 目标读者：引擎维护者 / 编辑器作者 / AI 协作代理。
> 本文是 `REARCHITECTURE.md` / `REARCH_FRONTIER.md` / `RC12_EDITOR_SEAM.md` 的姊妹篇，体例一致：描述目标架构与根治路径，而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`（2026-06 三路并行只读审计 + 交叉印证）。
> **立项缘由**：`RC12_EDITOR_SEAM.md` 描述的最优编辑器架构（隔离的 edit / play realm、play==ship）依赖"引擎能干净地承载多个隔离实例"。当前引擎结构上是**单进程、单活动上下文（进程单例）**——这是编辑器接缝脆弱（见本会话修的 headless null-context 崩溃）与"无法隔离 play"的共同根因。本文把它根治。

---

## 0. 核心诊断：引擎是"单例引擎"，但主模块其实已经实例化了

引擎对外表现为"只有一个活动上下文"，但深审发现**真相是分层的**：

1. **主模块的 per-app 状态早已收进 `EstellaContext`**。`EstellaContext`（`src/esengine/core/EstellaContext.{hpp,cpp}`）经 `ServiceRegistry` 拥有 GfxDevice / ResourceManager / RenderContext / StateTracker / RenderFrame / ImmediateDraw / GeometryManager / TransformSystem / UISystem / TweenSystem / (Timeline/Particle/Tilemap/Spine) + `EngineState`（material_cache / viewport / delta / view_proj）。主模块的渲染/资源/动画/瓦片/粒子子系统 `.cpp` **全部无文件级可变全局**——都已被 ServiceRegistry 持有。**主模块在数据结构上已经是 per-instance 的。**

2. **唯一卡住的是"活动上下文"是进程单例**：`g_activeContext`（`bindings/ActiveContext.hpp:13`）被 `initRenderer` 硬写成 `&EngineContext::instance().context()`（`bindings/WebSDKEntry.cpp:217,236`）。`EngineContext::instance()`（`bindings/EngineContext.cpp:6`）是进程唯一 Meyers 单例；`EstellaContext` **没有任何 embind**，JS 无法 `new` 它，也没有 `setActiveContext`（仅 `ActiveContext.hpp:11` 注释提到，无声明/定义）。

3. **真正搬不动的是 physics / spine —— 它们是独立 wasm 模块**。`CMakeLists.txt:450-545`：`spine_module` / `physics_module` 是独立 `add_executable`，各自独立 `.wasm`、**独立线性内存**，与主模块只走扁平 C ABI。它们的 per-app 状态是各自模块里的进程全局（`bindings/PhysicsContext.cpp:3` `PhysicsContext g_ctx`、`bindings/SpineModuleEntry.cpp:149` `SpineContext g_ctx`），**物理上无法 `registerOwned` 进主模块的 EstellaContext**。

> **关键洞察（决定整盘可行性）**：`RC12` 的最优编辑器架构用**隔离的 realm**（iframe / worker，每 realm 各自 instantiate 一份 wasm）。在那个模型里，每个 realm 有**自己的** physics/spine wasm——所以第 3 点这个最难的阻塞**对编辑器架构是天然回避的**。于是本文把工作切成：**Phase 1 主模块实例化（高价值、可做、解锁编辑器）** + **Phase 2 side-module 实例化（仅"单 realm 内多 App 共享一份 wasm"才需要，默认用'每 realm 独立 wasm'回避）**。

**根治原则**（承接 RC 系列）：把"进程级活动单例"降级为"显式注入的实例句柄"；把每一处"假设单 App / 单 context"的隐式全局收成显式 per-instance；side-module 的隔离用"每 realm 独立 wasm"在架构层回避，而非在 ABI 层强行打补丁。

---

## 1. 病灶（file:line）

### I1：活动上下文是进程单例，JS 无法 own / 注入
- `bindings/ActiveContext.hpp:13` `inline EstellaContext* g_activeContext = nullptr;`——进程全局活动指针。
- `bindings/WebSDKEntry.cpp:217,236` `g_activeContext = &legacyCtx().context();`——`initRenderer*` **硬写**成单例的 context，JS 不能控制"活动的是谁"。
- `bindings/EngineContext.cpp:6` `EngineContext::instance()`——进程唯一 Meyers 单例，内含唯一 `EstellaContext context_`。
- `EstellaContext` **零 embind**（全仓 `class_<EstellaContext>` 无命中）；`setActiveContext` **不存在**（仅 `ActiveContext.hpp:11` 注释）。
- `bindings/WebSDKEntry.cpp:230`（及 `:195`）`if (g_initialized) return true;`——`g_initialized = ctx().state().initialized`，**第二次 init 静默早退、复用同一单例**：两个 App 共享同一套 GPU 子系统 / viewport / material cache，互相践踏。

### I2：`ctx()` 是 6 份各自为政的定义，回退不对称
`ctx()` 在每个 binding `.cpp` 各自 `static` 重定义，语义不一：
- `WebSDKEntry.cpp:69-77`：`g_activeContext ? activeCtx() : legacyCtx().context()`——**唯一带单例回退**（本会话为 headless 修的）。
- `RendererBindings.cpp:34` / `ImmediateDrawBindings.cpp:23` / `GeometryBindings.cpp:25` / `PostProcessBindings.cpp:23` / `TilemapBindings.cpp:26` / `TimelineBindings.cpp:14`：全是裸 `return activeCtx();`——**无活动上下文即 `*nullptr` 解引用**。
- 后果：迁移到"显式实例上下文"后，任一路径若未先 `setActiveContext`，WebSDKEntry 的 UI/Tween 静默走单例、其余 6 处直接 null deref——同一引擎两种 null 语义，极易漏。约 **97 处 `ctx()` 调用，跨 7 个文件**（全部局限在 `bindings/`，未逃逸到 core/renderer/ecs——迁移面被收束在 bindings 层，这是好消息）。

### I3：没有 per-instance 销毁路径，活动指针会悬垂
- `app.quit()`（`sdk/src/app.ts:527-554`）只做 JS 清理，**从不调 `module.shutdownRenderer()`**；全仓无任何 TS 调用 C++ `shutdownRenderer`（`wasm.ts:78` 仅声明无 caller）。
- 结果：`EstellaContext` **运行中从不被销毁**，`g_activeContext` 从不置空；quit 后再 init 撞 `g_initialized` 早退复用旧单例。
- `~EstellaContext`（`EstellaContext.cpp:74`）会在 `initialized` 时 `shutdown()`，但 JS 走不到（没有 delete 路径）；且若 JS `delete` 掉的是当前活动 ctx，`g_activeContext` 变**悬垂**（`shutdownRenderer` 在 `:243` 才置 null，delete 路径绕过它）。

### I4：SDK 侧的"单 App 假设"——module 级单例
- 8+ 个渲染封装模块各持一份 module 级 `let module`：`renderer.ts:33`、`draw.ts`、`geometry.ts`、`material.ts`、`glDebug.ts`、`ui/uiHelpers.ts`、`spine/SpineCppAPI.ts`、`postprocess/PostProcessAPI.ts`、`tilemap/tilemapAPI.ts`。`corePlugin.build` 每次 `initXxxAPI(module)`（`corePlugin.ts:15-25`）**覆盖**前一个 App 的引用 → 这些全局函数只服务"最后连上的 module"。
- JS `AppContext` 懒单例 `defaultContext_`（`context.ts:99`），`world.ts` / `env.ts` / `app.ts:878` 全读 `getDefaultContext()`，多 App 默认串味（注释 `context.ts:90-98` 已自承）。
- SDK `AppContext`（componentRegistry/pendingSystems/editorBridge/playMode）与 C++ `EstellaContext` 是**两套平行、零联动**的"上下文"：`setDefaultContext` 绝不触碰 `g_activeContext`，反之亦然。

### I5：side-module（physics / spine）是另一个 wasm 里的进程全局
- `bindings/PhysicsContext.cpp:3` `PhysicsContext g_ctx`（b2WorldId + entityToBody/Shapes/Joint 映射 + buffers）；`bindings/SpineModuleEntry.cpp:149` `SpineContext g_ctx`（skeleton/instance 句柄表 + id 计数器 + buffers）。
- 它们 **不 include EstellaContext、不碰 `ctx()`**，是独立 wasm 的独立单例。主引擎做成多实例后，两个 App 实例仍共享**同一个 Box2D world / 同一个 spine 实例表**，互相踩 entityId。
- 最隐蔽：`bindings/PhysicsModuleEntry.cpp:58` box2d `b2Body_SetUserData` 存的是**裸 entityId、不带 world/app 标识**，多 world 且 entityId 重号时回调无法区分归属。

---

## 2. 目标架构：实例引擎（EstellaContext 一等实例）

### 2.1 主模块（Phase 1 —— 高价值、可做）

1. **EstellaContext 成为 JS 可 `new` 的 embind 类**（照抄 `Registry` 的机制 `WebBindings.generated.cpp:1176-1178`）：
   ```cpp
   class_<EstellaContext>("EstellaContext")
       .constructor<>()
       .function("init", &EstellaContext::init)        // init(glHandle) -> bool
       .function("shutdown", &EstellaContext::shutdown)
       .function("isInitialized", &EstellaContext::isInitialized);
   function("setActiveContext", +[](EstellaContext& c){
       g_activeContext = &c;
   }, allow_raw_pointers());
   ```
   `EstellaContext` 已满足前提：默认构造、`init(int)`、`shutdown()`、析构自动 shutdown、拷贝已 delete（引用语义，embind 友好）。

2. **JS App own 一个 cppContext**：`createWebApp`（`sdk/src/app.ts:850`）新增 `const cppContext = new module.EstellaContext()`，App 持有它（类似现持 `module_`）。用 `cppContext.init(glHandle)` + `module.setActiveContext(cppContext)` 取代 `module.initRendererWithContext(...)` 的硬绑单例（`app.ts:856-860`）。`Registry` 与 context 解耦（Registry 只作 `renderFrame` 参数），**无需绑进 context**；真正要保证的是"渲染/ tick 前活动的是本 App 的 context"——多 App 交替时每帧 `setActiveContext(app.cppContext)`。

3. **退役进程单例**：`g_activeContext` 保留（它就是"当前活动实例"开关，本就该 module 级）；但赋值改为**只由 `setActiveContext` 注入**，删掉 `WebSDKEntry.cpp:217,236` 的硬写。`EngineContext::instance()` 单例与 `g_initialized` 早退退役。

4. **统一 `ctx()` 为单一定义、单一语义**：把 6 份 file-local `ctx()` 收成一处共享定义（如 `ActiveContext.hpp` 里 `activeCtx()` 直接带"显式注入优先、否则 fatal/清晰诊断"），消除"WebSDKEntry 走回退、其余 null deref"的不对称。headless 工具走"显式创建一个未 init 的 EstellaContext 并 setActive"，而不是隐式回退单例。

5. **per-instance 销毁闭环**：JS `cppContext.delete()` → `~EstellaContext` → `shutdown()`；并在 shutdown/析构里 `if (g_activeContext == this) g_activeContext = nullptr;` 防悬垂。`app.quit()` 串上 `cppContext.delete()`（补 I3 缺口）。

6. **SDK 收口单 App 假设**：渲染封装的 module 级 `let module`（I4）改为"按 App/context 实例持有"（API 从 module 级函数挂到 App/context 实例上）；`createWebApp` 内 `setDefaultContext(new AppContext())`（或把 `AppContext` 直接挂到 `App` 上、移除 `defaultContext_`），让 JS 软状态也 per-App。

### 2.2 side-module（Phase 2 —— 默认回避，按需才做）

physics/spine 的 `g_ctx` 在另一个 wasm，三选一：
- **(a) 编进主模块**：把 physics/spine 源文件并入主 wasm，`g_ctx` 即可搬进 EstellaContext。代价：主 wasm 变大、box2d/spine 链接进主模块、放弃 side-module 拆分。
- **(b) 句柄表化 ABI**：side-module 内把 `g_ctx` 改成 `worldId/appId → Context` 句柄表，每个 EstellaContext 持一个 handle，所有 `physics_*`/`spine_*` 调用带 handle。代价：C ABI 大改 + box2d user-data 要加 world 标识。
- **(c) 每实例一份 side-module wasm**：每个 App/realm 各 `instantiate` 一份 physics.wasm / spine.wasm（`PhysicsModuleLoader.ts` 已是工厂式）。代价：每实例多一份 wasm 内存。

> **推荐：(c)，并在编辑器层用"每 realm 独立 wasm"自然落地**。编辑器的隔离 edit/play realm 本就各自一份 wasm，physics/spine 随之天然隔离——**Phase 2 在编辑器架构下基本不需要单独做**。只有当出现"单一 realm 内多个 App 共享一份 wasm 且都用物理/spine"的真实需求，才评估 (a)/(b)。

---

## 3. 拍板（已决，2026-06）

贯穿性前提决定了所有选型：**最优编辑器架构用隔离 realm（edit / play 各一个 iframe/worker，各自 instantiate 一份 wasm），即"每 realm 一份 wasm、一个 App"**。这把"单 realm 内多 App 共享一份 wasm"这个最难的场景整个消掉——side-module 全局与 SDK module 级单例都靠 realm 边界天然隔离，无需在 ABI/SDK 层强行打补丁。

| 岔路 | 已拍板 | 理由 |
|---|---|---|
| **side-module 隔离** | **(c) 每 realm 独立 wasm**，靠 realm 架构自动落地、本期零改动 | (a) 编进主模块否决：砸微信/playable 体积预算（`REARCH_FRONTIER §0.1`）+ 砸 spine 多版本；(b) 句柄表化延后：只为"单 realm 多 App 用物理"，而该需求不存在 |
| **EngineContext 单例** | **降级为"未设时的惰性默认 fallback"，去掉特权硬绑**（删 `WebSDKEntry.cpp:217/236` 的硬写 + `g_initialized` 早退） | 不激进删；真正的 App 走显式 `new EstellaContext()`，单例只兜底 headless/测试，不再强绑所有 App |
| **ctx() 统一** | **单一共享定义**：`activeCtx() = 显式注入优先，否则惰性默认` | 消除 6 份 file-local 定义的不对称回退（I2），是迁移正确性的硬前提 |
| **setActiveContext 时机** | **context 创建时设一次，不每帧切**（保留切换能力） | 一个 realm 一个 context，活动上下文 realm 内不变 → N3 更简单 |
| **生命周期所有权** | **JS own，显式 `.delete()`**（照抄 `Registry`）；shutdown/析构防 `g_activeContext` 悬垂 | 与 `new module.Registry()` 同构，最小心智负担 |
| **SDK module 级单例 / 多-App 收口（原 N5）** | **延后**：realm 隔离（每 realm 独立 JS context）让 `let module`×8 与 `defaultContext_` 天然各自一份 | 仅"单 realm 内多 App"才需要，而 realm 架构每 realm 一个 App |

### 已知的一处"务实 > 纯粹"
`setActiveContext` 是一个"当前上下文"全局（OpenGL `makeCurrent` 一类的可变全局——正是 RC 系列反对的环境全局反模式）。**接受它**，因为 realm 架构让它退化成"每 realm 设一次、永不切换"的事实常量，可变全局的真正危险（中途被切、另一路径读错）在"设一次"下不出现。最纯粹的"每 binding 显式传 context 句柄"要穿过 ~97 处 binding + 整个 JS SDK，为的是 realm 已给到的隔离——收益重复、成本巨大，故不选。这是少数"工程对、非教科书最纯"的点，明记在此。

---

## 4. 迁移序

### Phase 1 —— 主模块实例化（本期交付；可拆、每步可验证、全程构建常绿、零 ABI）
- **N1（纯加法、解锁一切）**：给 `EstellaContext` 加 embind（newable + `init`/`shutdown`/`isInitialized`）+ 自由函数 `setActiveContext`/`createEngineContext`。`wasm.ts`/`wasm.generated.ts` 增类型。**不改任何现有路径**，只是让 JS 能 new/设活动。验证：单测 `new module.EstellaContext()` → `setActiveContext` → UI layout 走到该实例（而非单例）。
- **N2（统一 ctx）**：6 份 file-local `ctx()` 收成单一定义、单一语义（`activeCtx() = g_activeContext ? *g_activeContext : 惰性默认`）；消除不对称回退（I2）。验证：headless 与 rendered 两路都不 null deref；require/tryGet 行为表一致。
- **N3（JS App own context）**：`createWebApp` `new` 一个 cppContext、`init` + 启动时 `setActiveContext` 一次（非每帧）；删 `initRenderer` 硬绑单例（`WebSDKEntry.cpp:217/236`）+ `g_initialized` 早退，改为受注入。验证：单 App 行为不变（回归 SDK 2166 + editor build）；**双 context 隔离测试**——一个 realm 内 `new` 两个 EstellaContext 各渲染各的 canvas，断言实体数/material_cache/viewport 互不串。
- **N4（销毁闭环）**：`cppContext.delete()` 路径 + shutdown/析构里 `if (g_activeContext==this) g_activeContext=nullptr` 防悬垂 + `app.quit` 串接 delete（补 I3）。验证：`create→init→quit→delete ×N` 无泄漏（service 计数归零 / WebGL context 不泄漏）、无早退复用。

### 延后 / 被 realm 架构吃掉（非本期）
- **~~N5 多-App 收口~~**：退役单例的"特权"在 N3 已做；剩下的"SDK module 级 `let module`×8 + `defaultContext_` 改 per-App"**仅"单 realm 内多 App"才需要**——realm 架构每 realm 一个 App、一份 JS context，天然隔离，故延后（出现真实需求再做）。
- **~~Phase 2 side-module 实例化~~**：physics/spine 的 `g_ctx` 靠"每 realm 独立 wasm"隔离（选型 (c)），本期零改动；仅"单 realm 多 world 都用物理"才评估句柄表化 (b)。

### 编辑器层（接 RC12，独立条目）
- **N6**：编辑器隔离 realm（edit / play 各一份 wasm 实例）落地——吃掉 side-module 隔离、接通 `RC12` 的 play==ship。属 `RC12_EDITOR_SEAM.md` 的范畴，以 Phase 1 为前置。

---

## 5. 验证机制
- **N1**：`new module.EstellaContext()`+`init`+`setActiveContext` 后，`require<UISystem>()`/几何绘制命中该实例（而非单例）。
- **N3/N5**：**双 App 隔离测试**——两个 App 各自 `new EstellaContext`，分别 spawn 不同实体、渲染到不同 canvas，断言：各自 Registry 实体数独立、material_cache/viewport 独立、互不串味。
- **N4**：`for (create→init→quit→delete) ×N` 后 C++ 端 service 计数归零、无 WebGL context 泄漏、`g_activeContext` 不悬垂。
- **回归**：现有 SDK 2166 测试 + editor typecheck/build 全绿（单 App 路径行为不变）。
- **门禁**：双 App 隔离测试进 CI（native 或 headless wasm）。

---

## 6. 与其他条目的关系
- **解锁 `RC12_EDITOR_SEAM.md` 的最优架构**：隔离 edit/play realm、play==ship 都要求"引擎可干净多实例 + 干净销毁/重建"——N1–N5 是其前置。
- **承接本会话的 headless-context 修复**：`ctx()` 的单例回退（`WebSDKEntry.cpp:76`）是 N2 的临时形态；N2 把它转正为统一语义。
- **与 E2（编辑器 World 写边界）正交**：E2 收编辑器侧写门，本文收引擎侧实例边界，互补。
- **不与 RC1（ABI 单源）冲突**：实例化不动组件布局/哈希，零 ABI 变更（embind 加法）。
