# Estella 地基收口（Foundation Consolidation）— RC6 前置

> 目标读者：引擎维护者 / AI 协作代理。
> 本文是 `REARCHITECTURE.md` 的续篇，体例一致。**执行上先于 [`REARCH_RC6_ASSETS.md`](./REARCH_RC6_ASSETS.md)**——在叠加资产管线（能力层）之前，先把地基收成"统一、简洁、无半成品"。
> 现状审计见各小节"病灶"引用的 `file:line`（2026-06 全仓审计）。

## 0. 核心诊断：RC1–RC5 之后，地基仍有四处未收口

RC1–RC5 坍缩了五个正确性根因，但留下四处"半成品 / 未统一 / 已死却仍拖累每个文件"的地基债。它们都是同一组原则的延伸——**单一通道、单一真相、减法优先**：

1. **平台差异散落为内联 `#ifdef`**：`ES_PLATFORM_WEB / #else` 双臂遍布 ResourceManager / Texture / Log / Engine / PathResolver。仓库已 web-only（native 平台层删于 `d9a08d87`，CI web-only `c9b476e4`），native 既不出货也不被测试，却仍以双臂形式污染业务逻辑。
2. **SDK 五套 WASM 桥接写法**：RC5 的"统一 WasmBridge"未做；且 abort 守卫只覆盖主模块。
3. **状态半 per-App**：Tween/Audio/Scene 已资源化，Camera/SpriteAnimator/PostProcess/Timeline + 六个 core 模块仍是进程级全局。
4. **文档漂移**：`ARCHITECTURE.md` 描述的类已在 RC5 删除。

**决议（已拍板）**：native **保留但隔离**——不删，但从散落 `#ifdef` 收敛到单一平台后端接缝，使其要么被 CI 编译守护、要么被明确隔离，**不再污染业务代码**。

---

## F1：平台差异 → 单一平台后端接缝（保留 native，隔离之）

### 病灶
- **内联 `#ifdef` 双臂遍地**：`ResourceManager.cpp:14-19/37-40/54-57/72-76/125-152/541-586`（ShaderLoader + 热重载 + stbi 全套）、`Texture.cpp:19-21/124-160`（`stbi_load`）、`Log.hpp:26-28` + `Log.cpp:22-24/61-63/70-72/80-82`（sink mutex）、`Engine.cpp:23-28/37-39/45-46`（Win/Mac/Linux 平台名）、`PathResolver.cpp:110-168/180-185`（OS 路径分支）。
- **孤儿死代码**：`LoaderJobQueue.cpp`（`std::thread` 线程池）——web 不编译，**native 下也从无调用**；`AsyncHandle`（`resource/AsyncHandle.hpp:67-151`）同样无引用。**含义：C++ 侧"异步加载"目前是虚的**，RC6 的流式不能建在其上。
- **合法但应单点化的平台选择**：`OpenGLHeaders.hpp:18-30`（GL 头按平台 include）、`CMakeLists.txt:326`（glfw/glad/OpenGL 仅 native 分支链接）。

### 目标架构
- **一处平台概念 = 一个接口 + 每平台一份实现**，业务逻辑零内联 `#ifdef`。沿用现有 `WebFileSystem` 的"接口 + per-platform impl"范式（`platform/web/WebFileSystem.cpp`）推广到其余概念：
  - `IImageDecoder`：native = stbi（`Texture::createFromFile`）；web = JS 侧 ImageBitmap 解码后交字节（`registerExternalTexture`）。
  - `IAsyncLoader`：native = `LoaderJobQueue`（std::thread）；web = 主线程 / JS Promise 驱动。**接通它**（消灭孤儿），因为 RC6 流式要靠它。
  - `IHotReload`：native = `HotReloadManager`；web = no-op 实现（而非 `#ifdef` 抹掉调用点）。
  - `PathResolver` / `Engine::getPlatformName`：拆为 `*.web.cpp` / `*.native.cpp`，由 CMake 按目标选 TU，而非文件内 `#ifdef`。
- **可单点化的简化**：`Log` 的 sink mutex 永远编译（单线程下无竞争锁开销可忽略）→ 删掉 `#ifdef`。GL 头 include 保留**单一** `#ifdef`（它本就是唯一接缝，合理）。
- **防腐**：`ES_BUILD_NATIVE` 提升为一等目标，**至少进 CI 做编译门禁**。否则"隔离"留下的 native 会再次 bit-rot，隔离即白做——这是本决议成立的硬前提。

---

## F2（keystone）：五套桥接 → 单一 `WasmBridge` 基类 + 守卫下沉

### 病灶
- 桥接写法 5+ 套，各自实现 loader / ready / 错误 / 缺绑定策略：
  - 类式：`BuiltinBridge`（`sdk/src/ecs/BuiltinBridge.ts:299`）
  - 全局单例 init/shutdown ×6：`postprocess/PostProcessAPI.ts:9`、`geometry.ts:43`、`draw.ts:23`、`material.ts:98`、`glDebug.ts:8`、`renderer.ts:31`
  - 子系统接口 ×3：physics 直传参（`physics/PhysicsSystem.ts:79`）、spine（`spine/SpineCppAPI.ts:4`）、tilemap（`tilemap/tilemapAPI.ts:102`）
  - 其它：timeline 全局模块（`timeline/TimelineControl.ts:4`）、uiHelpers 模块+注册表对（`ui/uiHelpers.ts:83-84`）
- **abort 守卫只装在 `BuiltinBridge`**（`BuiltinBridge.ts:331`，包装在 `resolveAndCache_` 473-485）。physics/spine/timeline 的 WASM 调用**全程无守卫**（`PhysicsSystem.ts:79+`、`TimelinePlugin.ts:138+`、spine `SpineController`）——模块 abort 后继续调尸体，正是 RC3 要消灭的失败模式。

### 目标架构
- **单一 `WasmBridge` 基类**：一个 loader、一个 ready promise、一条缺绑定策略、一条错误路径。六个全局模块单例 + 三套子系统接口 + timeline/uiHelpers 全部继承它。
- **守卫下沉**：基类在唯一收口处统一"调用前 `throwIfModuleAborted` + 调用中 abort 则致命重抛"（把 `BuiltinBridge` 已验证的 `resolveAndCache_` 模式提升到基类）。所有子系统**自动**获得 abort 安全，无需各自补。
- F2 一步同时解决"统一"与"基础安全"两件事。

> 这是 keystone：它既是 RC5 SDK 尾巴的收口，也是 RC3 abort 覆盖的补全，还是 F3 的载体（基类持 per-App 模块引用）。

### 实现 — ✅ 已落地（commit `ac390f7d`，分支 `rearch/f2-wasm-bridge`）
- **`WasmBridge<M>`（`sdk/src/WasmBridge.ts`）**：`connect(module, healthModule?)` 装 abort 守卫并返回**同型守卫代理**——函数调用经 `throwIfModuleAborted` 前置 + 调用中 abort 则致命重抛；`HEAP*`、`_malloc/_free` 透传（让 `withScratch` 的 finally 在 abort 后仍能释放，不掩盖原错）。守卫包装按属性惰性缓存，稳态开销仅一次 proxy get + Map 查找。`healthModule` 参数支持"调用面与 abort 权威模块分离"（spine side module：守 `api`、health=`raw`）。
- **`CoreApiBridge`（`sdk/src/CoreApiBridge.ts`）**：label 走构造参数的共享子类，用于主模块各 facet——renderer/draw/material/geometry/postprocess/glDebug + tilemap + timeline + uiHelpers。
- **`PhysicsBridge` / `SpineCoreBridge` / `SpineModuleBridge`**：physics + spine 两个 surface（主模块 `spine_*` 与版本化 side module）。
- **迁移方式**：每个子系统在其 init/connect 接缝处把存储的 module 引用替换为 `bridge.module`，**数百个调用点零改动**继承守卫。
- **覆盖**：abort 守卫从"仅主模块经 BuiltinBridge"扩展到 physics / spine / tilemap / timeline / ui / 六个 core facet **全覆盖**——补全 RC3 空洞。
- **验证**：29 个新测试（wasm-bridge 12 / spine-bridge 7 / core-bridge 4 / timeline-tilemap-ui 6）；typecheck 通过；全量 SDK 套件 **2052 通过 / 0 失败**。
- **`ResourceManager` 闭环 — ✅**：embind RM 对象经 `WasmBridge`（health=主模块）守卫，`initResourceManager(rm, module)` 接缝路由；测试路径（无 module）保持 raw 向后兼容。至此 SDK 全部 WASM 调用面均经守卫。`Camera` 的 module 触点归 F3。

---

## F3：半 per-App → 全子系统 per-App 资源

### 病灶
- 已正确（per-App 资源）：`Tween`（`animation/Tween.ts:217`）、`Audio`（`audio/Audio.ts:279`）、`Scene`（`sceneManager.ts:662`）。
- 仍进程级全局：Camera 池（`camera/CameraPlugin.ts:36`，永不重置）+ 缓存 app（`camera/Camera.ts:7`）；SpriteAnimator clip 注册表 + 事件监听（`animation/SpriteAnimator.ts:43/65-66`，跨 App 泄漏）；PostProcess 注册表（`postprocess/PostProcessStack.ts:27`，手动 swap）；Timeline 模块（`timeline/TimelineControl.ts:4`）；六个 core 模块全局（geometry/draw/material/glDebug/renderer + uiHelpers）。
- 后果：多 App / 编辑器反复 F5 预览时**状态串味、资源泄漏**。

### 目标架构
- 所有子系统运行时状态改为 **per-App/per-World 资源**（`defineResource`），与 Tween/Audio/Scene 对齐。
- **搭 F2 的车**：模块引用由 `WasmBridge` 基类按 App 持有；子系统状态挂 App 资源。App 销毁 = 状态随之回收，无需手动 reset/swap。

---

## F4：文档漂移 → 与代码对齐

### 病灶
- `ARCHITECTURE.md` 仍描述 RC5 已删除的 `Renderer`（静态 API）、`RenderCommand`、`BatchRenderer2D`；SparseSet/Entity 布局写的是旧版（实际分页 + 20-bit index+generation，见 `Registry.hpp:552`）。

### 目标架构
- 重写 `ARCHITECTURE.md` 的渲染与 ECS 段，与 RC1–RC5 后的真实类（`GfxDevice`/`RenderFrame`/`DrawList`/分页 `SparseSet`）对齐。文档亦受"单一真相"约束。

---

## 一处已澄清的好消息（无需动作）
- **JS→C++ 边界在 release 下安全**：`Registry::valid()`（`Registry.hpp:197-201`）是纯运行时布尔检查，**非** `ES_ASSERT`；生成的 embind 包装器每个入口 `if (!r.valid(entity) || !r.has<>()) return`（`WebBindings.generated.cpp:1196`）。RC1 codegen 已把守卫生成进去。仅 `emplace/get` 的 **C++ 内部**调用还靠 `ES_ASSERT`（`Registry.hpp:243/262/305`），属可信引擎代码，风险面远小于原文档担心。**RC3 的"release 剥离校验"项可降级关闭。**

---

## 执行顺序（全程保持构建常绿，每批可独立验证）

1. **F2 — 单一 `WasmBridge` 基类 + 守卫下沉**（无依赖、价值最高，先做）。逐子系统迁移：core 六模块 → physics → spine → tilemap → timeline → uiHelpers。每迁一个，typecheck + 该子系统测试守门。
2. **F3 — 全 per-App 资源化**（搭 F2）。每子系统：全局单例 → `defineResource`；补"双 App 互不串味"测试。
3. **F1 — 平台后端接缝**（保留 native，隔离）：先 `IImageDecoder`/`IAsyncLoader`/`IHotReload` 抽接口，把 `#ifdef` 业务臂迁进 per-platform impl；`PathResolver`/`Engine` 拆 TU；`Log` mutex 去 `#ifdef`；**接通 `LoaderJobQueue`（消灭孤儿，为 RC6 备好 native 异步）**；CMake 把 `ES_BUILD_NATIVE` 接进 CI 编译门禁。
4. **F4 — 重写 `ARCHITECTURE.md`**（可并行，随时做）。
5. → 然后进 **RC6 资产管线**。

> 依赖：F2 是 keystone（F3 搭其车，RC6 的桥接靠它）；F1 的 `IAsyncLoader` 接通是 RC6 流式的前置；F4 无依赖。

---

## 验证机制
- **F2**：单一基类的 loader/ready/error 单测；abort 注入测试覆盖 physics/spine/timeline（模块标死后调用即致命重抛，不再调尸体）。
- **F3**：每子系统"创建两个 App → 各自改状态 → 互不可见 → 销毁其一另一无残留"测试。
- **F1**：`ES_BUILD_NATIVE` + `ES_BUILD_WEB` 双目标 CI 编译；接口实现切换的行为对拍（web no-op vs native 实现）；`LoaderJobQueue` 接通后的 native 异步加载冒烟测试。
- **F4**：人工复核 + 关键类名 grep 一致性（文档提到的类必须在代码中存在）。

## 需要拍板的岔路
| 岔路 | 选项 A | 选项 B（推荐） |
|---|---|---|
| **native CI 力度** | 仅本地偶测（会 bit-rot） | **CI 编译门禁**（隔离才不白做；这是"保留 native"决议的硬前提） |
| **`LoaderJobQueue` 时机** | 留到 RC6 再接 | **F1 即接通**（顺手消灭孤儿，RC6 直接有 native 异步底座） |
| **core 六模块 per-App** | 维持进程级（编辑器预览串味） | **随 F3 一并资源化**（多 App 干净，编辑器 F5 无残留） |
