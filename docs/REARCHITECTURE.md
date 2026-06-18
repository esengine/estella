# Estella 根治方案（Re-architecture Plan）

> 目标读者：引擎维护者 / AI 协作代理。
> 本文是**架构权威文档（architecture-of-record）**，描述目标架构与根治路径，而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`。

## 0. 核心诊断：同一事实的多个独立来源

对全仓（C++ ~34K 行、TS SDK ~35K 行）的深度审计后，几乎所有"脆弱 / 不完整 / 不清晰"的症状都可以归到**两类结构性病根**：

1. **多源真相（multiple sources of truth）**：同一个事实——内存布局、类型 ID、组件存储、枚举值——在 C++ 侧和 TS 侧、或在多个子系统里被**各自独立地定义/计算**，没有任何机制保证它们一致。它们会悄悄漂移，漂移后是**静默的内存损坏**，不是报错。
2. **可绕过的抽象（bypassable abstractions）**：`GfxDevice`、ECS 存储、WASM 桥接等抽象不是唯一通道，调用方可以绕过它直达底层。于是抽象只覆盖了一半，缓存/不变量被悄悄破坏。

**根治原则**：把每一处"多源"坍缩成**单一权威来源**，并由编译期断言 + 运行时握手强制一致；把每一个抽象做成**唯一通道**（绕过即编译不过）。下面五个根因，每个对应一个要建立的"单一权威来源"。

止血式修单点 bug 不在本方案范围内——因为只要多源结构还在，同类 bug 会无限再生。

---

## 根因 1（keystone）：边界不是单一事实来源 → 契约优先的边界

### 病灶
- TS 侧内存偏移由 EHT 的 Python **手写打包模型**算出（`tools/eht/.../ptr_layout.py`），C++ 侧由编译器实际布局决定——**同一事实算了两遍**。一致性只靠 `WebSDKEntry.cpp:248-372` 里**手写、仅覆盖 8 个组件**的 `static_assert(offsetof)`。EHT 模型还是近似的（`i8` 当 `u8`、假设 enum 恒 1 字节）。
- `wasm.ts` 里 ~400 行 `ESEngineModule` 接口是**手工镜像**，与散落在 12 个 `bindings/*.cpp` 的真实导出无任何交叉校验；能生成权威 d.ts 的 `--emit-tsd` 因"binding mismatch"被关掉（`Emscripten.cmake:201`）。
- 必须与 C++ 对齐的枚举（`Tween`/`Easing`/`BodyType`）、跨模块 physics 结构体（`PHYSICS_BODY_BYTES=16` 只活在一句 TS 注释里）、material uniform wire format——全是**两侧手维护**。
- 漂移检测存在但**默认关闭**（`strict:false`），且只比组件名集合，不比偏移/类型/枚举宽度；**无 ABI 版本握手**。

### 目标架构
1. **C++ 组件结构体是唯一权威**（保留 `ES_COMPONENT/ES_PROPERTY` 注解）。
2. **编译器是偏移的唯一权威**。EHT 不再自己算 packing：改为生成一个"布局反射"翻译单元，由编译器吐出每个组件每个字段的 `offsetof/sizeof/alignof`（constexpr 数据，从模块导出或在构建期产出）。TS 偏移从**这份编译器产物**派生，不再独立计算。
3. **一份 spec 生成边界全部内容**：embind、指针访问器、TS 类型、`ESEngineModule` 接口（恢复/替代 `--emit-tsd`）、所有跨界枚举、跨模块结构体、所有 `_malloc` wire format。两侧都生成，**零手工镜像**。
4. **全组件编译期断言**：EHT 为**每个**组件每个字段生成 `static_assert(offsetof==N)`。不一致 = **编译失败**，而非运行时静默损坏。
5. **运行时 ABI 握手**：同一次 EHT 产出一个布局哈希，注入 C++（`getAbiHash()`）和 TS 常量；`connect()` 时比对，不一致直接拒绝启动。**握手默认且唯一**，删掉 `strict` 开关。

> 这一步是 keystone：它一次性坍缩掉偏移双算、手镜像模块、手维护枚举、physics 结构体注释、`--emit-tsd` 关闭、可选漂移检测；并且**它生成的 static_assert + 握手，正是后续每一步重构的安全验证机制**。

---

## 根因 2：四套并行的组件存储 → 单一存储核心

### 病灶
稀疏集逻辑被实现了 **4 遍**：`SparseSet<T>`（编译期 typed）、`SchemaComponentPool`（给 JS 的裸字节，`SchemaComponent.hpp`）、`DynamicComponentPool`（`emscripten::val`/`std::any`）、`Registry` 的 128-bit mask。三者销毁路径不统一——**动态组件在实体销毁时根本不被清理**（`Registry` 不持有 `DynamicComponentRegistry`，`Registry.hpp:138-170`）→ 泄漏。SDK 侧还另有 JS-storage 组件 vs C++-storage builtin 的二分。

### 目标架构
- **一个稀疏集核心**（分页稀疏数组 + 稠密数组，写一遍）。typed 访问、JS 裸指针访问、dynamic 访问都是它之上的**视图/访问器**，不是各自的实现。
- 规范存储用 **flat-byte 布局**——因为零拷贝跨界本来就要求扁平字节，所以它天然是 RC1 生成的访问器的目标。typed C++ 组件即"对这块字节的类型化视图"。
- **同一个注册表、同一个成员 mask、同一条销毁路径**覆盖全部三类。坍缩掉动态组件泄漏与 4x 重复。

---

## 根因 3：无连贯的错误/生命周期模型 → 端到端单一契约

### 病灶
- C++ 用 `-fno-exceptions` 编译，出错 `abort()` **整个模块**；TS 却用 try/catch 兜底**继续调用这具尸体**（`BuiltinBridge.ts:471-527`）。无 `onAbort`、无健康标志、无错误通道——最坏组合。
- `get...Ptr` 返回**借用指针**，指向会随 ECS 池重分配而移动、随 `ALLOW_MEMORY_GROWTH` 而失效的存储；已有 `registry_getSchemaPoolVersion` 守卫但**没接进任何调用点**。
- `_malloc/_free` 无 try/finally，抛异常即永久泄漏 WASM 堆。
- 不变量检查全是 `ES_ASSERT`，**release 构建编译成空操作**（`Log.hpp:313`）→ 出货版里所有来自 JS 的 `get/emplace/destroy` **零越界检查**。

### 目标架构
- **错误**：边界函数返回**显式状态/optional**；边界校验**始终开启**（独立于 `ES_ASSERT`，不被 release 剥离）；安装致命 `onAbort` 翻"模块已死"标志，之后所有调用短路抛 `WasmModuleAborted`，**不再调用尸体**。
- **内存**：跨界裸指针只经**版本校验访问器**（接通 `getSchemaPoolVersion`，每次重取 HEAP 视图）；`_malloc` 只经 RAII `withScratch()` 作用域；跨界句柄 RAII。
- 坍缩掉 UAF、抛异常泄漏、abort-into-corpse、release 剥离检查。

> 岔路（需拍板）：是否改用 `-fwasm-exceptions` 让 C++ 失败变成可捕获的 JS 异常（体积/性能略增，TS 现有 try/catch 立刻有意义）vs 保持 `-fno-exceptions` + 显式状态码。**推荐后者**：保住体积/速度，把错误显式化而非依赖异常。

---

## 根因 4：全局 TypeId → 按域 + 按实例的确定性身份

### 病灶
单个全局 `getTypeId<T>()` 计数器被 **ECS / 事件 / 服务三套系统共享**，并直接当 `pools_` 下标（`Types.hpp:186`、`Registry.hpp:581`、`Dispatcher.hpp:229`、`ServiceRegistry.hpp:62`）。ID 按首次使用顺序分配 → **链接顺序相关、不确定**；某组件 ID 偶然很大就撑出一个全是 null 的超大 `pools_`；热重载/多模块下静默错位。

### 目标架构
- **按域独立的类型序列** `TypeIndex<Domain>`（Component / Event / Service 各一套）。
- 组件用**注册表局部的 dense id**（`std::type_index → 局部 id` 映射，或启动时按固定顺序显式注册），作为池下标。
- 坍缩掉链接顺序不确定、超大 pools、热重载错位、三系统耦合；这也是任何多模块/热重载故事的前置。

---

## 根因 5：抽象可绕过 → 抽象成为唯一通道

### 病灶
- `Texture/Shader/Buffer/Framebuffer` 全部直接调原始 `glXxx`，绕过 `GfxDevice`，使 `StateTracker` 缓存悄悄失效；`Texture` 仅 `ES_PLATFORM_WEB` 下有实现，native 构建里贴图是死的。
- **两套渲染器并存**：遗留 `Renderer/BatchRenderer2D` vs `RenderFrame`，批 shader 初始化等逻辑复制粘贴。
- 渲染 plugin **反向钻进**内容系统读/改运行时状态（`TilemapRenderPlugin.cpp:177` 在 const collect 里改 `dirty`）。
- SDK 有**五套互不相同的 WASM 桥接写法**；per-App 状态归属不统一（Tween/Audio/Scene 是 per-App，Camera/Timeline/SpriteAnimator/postprocess 仍是进程级全局）。
- 批渲染 EBO 全局累加，`baseVertex` 强转 `u16`，超 65535 顶点**静默回绕、GPU 读垃圾**（遍布所有批 plugin）。

### 目标架构
- **渲染唯一路径**：保留 `RenderFrame`，退役 `Renderer/BatchRenderer2D`。`GfxDevice` 成为**唯一 GPU 入口**——`Texture/Shader/Buffer` 接受 `GfxDevice&`，所有 bind 经 `StateTracker`。索引 `u16→u32`（或每帧到顶就 flush），让渲染路径**正确**而非打补丁。
- **内容系统写"渲染就绪快照"，plugin 只读**，renderer 不再依赖内容系统头文件/生命周期。
- **SDK 单一 `WasmBridge` 基类**：一个 loader、一个 ready promise、一个"缺绑定"策略、一条错误路径；五套写法全部继承它。
- **单一状态归属**：所有子系统状态改为 per-App/per-World 资源。

---

## 执行顺序（根因序，全程保持构建常绿）

每一步都由 RC1 生成的 `static_assert` + ABI 握手 + 可跑的边界测试守护。**验证机制不是"安全网目的"，而是验证根治是否成立的手段**——它本身就是 keystone 的一部分。

1. **建立验证机制 + keystone（RC1）**：让 WASM 边界测试在本仓库内可跑（当前指向不存在的 `desktop/`）；EHT 生成全组件 `static_assert` + 布局哈希握手 + 完整边界 codegen。完成后，任何边界漂移都变成编译/启动失败。
2. **RC4 身份**：拆分全局 TypeId 为按域序列 + 注册表局部 id。改动局部、风险低、解锁热重载。
3. **RC2 存储**：四套存储收敛到单一核心，统一销毁/mask 路径。由 RC1 的字节布局契约护航。
4. **RC3 错误/生命周期**：显式状态 + 始终开启的边界校验 + onAbort + 版本校验指针 + RAII `_malloc`。
5. **RC5 抽象唯一化**：退役遗留渲染器、GfxDevice 唯一入口、u16→u32、统一 WasmBridge、状态全 per-App。

> 注：仓库目前是从 monorepo 拆出的半成品（CI/测试/docs 仍引用不存在的 `desktop/`+`editor/`，无 PR 门禁，`docs/ARCHITECTURE.md` 描述的类名与代码不符）。这不是"安全网策略"，而是**根治的前置条件**：没有可跑的构建+边界测试，就无法验证上述任何一步是否真的成立。故第 1 步内含"让仓库自洽可建可测"。

## 需要拍板的两个架构岔路

| 岔路 | 选项 A | 选项 B（推荐） |
|---|---|---|
| **错误模型（RC3）** | `-fwasm-exceptions`：C++ 失败变可捕获 JS 异常，TS 现有 try/catch 立即有效；体积/性能略增 | 保持 `-fno-exceptions` + 边界函数显式状态码 + 致命 onAbort。保住体积/速度，错误显式化 |
| **规范存储（RC2）** | 保留 typed pool 为主、schema 为投影 | 以 flat-byte schema pool 为唯一核心。零拷贝跨界天然契合，与 RC1 的生成访问器同一目标 |

## 实现进度（living status）

### RC1 keystone — ✅ 已落地（第一批）
- **编译器成为偏移权威**：EHT 为**全部**组件的每个指针字段生成 `static_assert(offsetof==N)`（`tools/eht/generators/ptr_layout.py::generate_layout_asserts`），注入 `WebBindings.generated.cpp`。任何 EHT 模型与真实编译器布局的分歧 = 构建失败。已删除 `WebSDKEntry.cpp` 中手写、仅覆盖 8 个组件的断言。生成的 8 个组件偏移与原手写（经编译器验证）值逐字节一致，证明模型正确。
- **运行时 ABI 哈希握手**：`tools/eht/abi.py` 从单次 schema 解析计算布局哈希，同时注入 C++（`getAbiLayoutHash()`）与 TS（`ABI_LAYOUT_HASH`，在 `component.generated.ts`）。`BuiltinBridge.connect()` 比对，不一致**无条件致命**（即使非 strict 模式），因为 mock registry 不暴露该函数所以测试不受影响。当前哈希：`f5d18743d00de675`。
- **EHT 路径健壮性**：修复了 `--ts-output sdk/src` 会静默跳过 `component.generated.ts` / ptrLayouts / ptrAccessors 的潜在 bug（之前它们只在非默认 `--ts-output sdk` 下才重新生成）。现在标准构建会让全部生成的 TS 保持同步。
- **边界测试可在仓库内运行**：`sdk/tests/helpers/loadWasm.ts` 成为 WASM 路径单一来源（`$ESENGINE_WASM_DIR` → `build/wasm/web` → 旧 `desktop/public/wasm`），8 个集成测试文件不再各自硬编码不存在的 `desktop/public/wasm`。
- 验证：SDK typecheck 通过；2012 个测试通过（含 3 个新握手测试，证明 mismatch 在非 strict 下也致命）；EHT 幂等。**待补**：C++ 侧 `static_assert` + `getAbiLayoutHash` 的实际编译验证需要 emsdk（随 CI web 构建门禁一起闭环）。

### RC4 身份 — ✅ 已落地并**编译+运行验证**
- `core/Types.hpp`：单一全局 `getTypeId<T>()` 计数器拆为**按域独立**的计数器。新增域标签 `ComponentDomain/EventDomain/ServiceDomain/ResourceDomain` 与具名 helper `componentTypeId/eventTypeId/serviceTypeId/resourceTypeId`（各自 0 起、密集）。移除共享的 `getTypeId`/`nextTypeId`。
- 调用点迁移：`Registry`→`componentTypeId`、`Dispatcher`→`eventTypeId`、`ServiceRegistry`→`serviceTypeId`、`LoaderRegistry`→`resourceTypeId`。组件 id 现在密集，`pools_` 向量与 128-bit 组件 mask 不再被无关的事件/服务/资源类型撑大或溢出。
- 全仓已无 `getTypeId` 残留（仅本文档"病灶"描述保留旧名）。各容器（pools_/signals_/services_/loaders_）本就相互独立，跨域 id 无需全局唯一，故拆分零语义风险。
- **验证**：用本机 MSVC（VS Build Tools）+ glm 编译一个独立 harness 包含全部四个被改头文件并运行通过。关键证据：先注册 6 个事件/服务/资源 id 后，组件 id 仍为 `0 1 2`（旧共享计数器下会是 `6 7 8`）；Registry emplace/has/tryGet/remove、Dispatcher trigger、ServiceRegistry 均跑通。
- **顺带修复**：`SparseSet.hpp` 用了 `std::array<u32,4096>` 却没 `#include <array>`（依赖 Emscripten/libc++ 的传递包含，MSVC 下编译失败）——补上，消除一处潜在可移植性 bug。

### 验证能力（已确认可用）
本机**存在原生 C++ 工具链**：VS Build Tools（`D:\VisualStudioBuildTools`，cl.exe 14.50）+ ninja + cmake，doctest 已 vendored，glm 子模块已初始化。被改的 ECS/事件/服务/资源代码均为 header-only，可用独立 harness 直接编译+运行验证（如 RC4 所做）。完整 `esengine` 静态库的原生构建还需更多子模块/native 依赖（glfw/glad/box2d/spine 等），属后续 CI 门禁范畴。**结论**：RC2/RC3/RC5 的 header-only 部分可在本机即时编译验证，不再是纯人工审阅。

### RC2 存储统一 — ✅ 已落地并**编译+运行验证**
- **调研推翻了"四套并行实现"的前提**：`DynamicComponentPool` 是**纯死代码**（全仓无引用）；`SchemaComponentPool`/`SchemaRegistry` **几乎全死**（Registry 暴露 13 个包装，但只有 `getSchemaPoolVersion` 一个绑定有注册，且 SDK 侧零调用）；唯一活着的存储是 typed `SparseSet<T>`，而 JS 零拷贝**早已直接读 typed 存储的指针**（`getXxxPtr` 返回 `tryGet<T>()` 的 `T*`，按 keystone 偏移读 HEAP）。
- 故根治改为**靠删除而非改造**：删 `DynamicComponent.hpp`、`SchemaComponent.hpp`；从 Registry 移除 `schemaRegistry_`、13 个 schema 包装、destroy 里的 schema 清理（销毁路径现为纯 mask 驱动的单一路径）；移除死绑定 `registry_getSchemaPoolVersion`（C++ impl/decl/注册 + `wasm.ts` 声明）。存储实现数 **3 → 1**，零 UB 风险（typed `std::vector<T>` 本就正确处理非平凡组件）。
- `SparseSet` 新增 `version()`：在组件缓冲**重分配**（emplace 扩容）、**relocate**（remove swap-pop、sort/rebuildSparse）时自增——作为 RC3 跨界指针失效守卫的**单一来源**，取代已删除的 `SchemaComponentPool::poolVersion`（后者还漏了 remove 时不自增的 bug）。
- **验证**：native MSVC harness 编译+运行通过（version() 在 fill/remove/clear 后均自增；destroy 后回收的实体无残留组件）；SDK typecheck + 2012 测试全过。

### RC3 错误/生命周期 — 🟡 进行中（错误通道已落地并测试）
错误模型已定：**保持 `-fno-exceptions` + 显式状态 + onAbort 死亡标志**（不增体积/不降速）。
- ✅ **错误通道（已完成）**：新增 `moduleHealth.ts`——`WasmModuleAborted` + 按模块的死亡标志 + `installAbortGuard`（挂 emscripten `Module.onAbort`，保留既有 handler）。`handleWasmError` 对 `WasmModuleAborted` **重抛不吞**（abort 是终态，吞掉就是继续调用尸体）。`BuiltinBridge` 在 `connect` 装守卫，并在唯一收口 `resolveAndCache_` 把四个边界方法包成"调用前短路 + 调用中 abort 则致命重抛"。验证：typecheck + 8 个新测试 + 全套 2020 测试通过。
- ✅ **RAII `_malloc`（已完成）**：新增 `wasmScratch.ts`——`withScratch(mod, alloc => …)` / `withMalloc`，作用域内分配的所有缓冲在回调返回**或抛异常**时按逆序释放。把 9 个文件的全部瞬时分配站点（runtimeLoader、TextureLoader、PhysicsSystem×3、TimelineUploader×6、ModuleBackend、SpineController×4、tilemapAPI×3、tiledLoader×4、TextRenderer）迁到该助手；持久缓冲（material/draw/renderer/geometry 的 alloc-once）与已有 try/finally 的站点不动。验证：5 个新 helper 测试 + typecheck + 全套 2025 测试；逐一人工复核 TimelineUploader/SpineController 等复杂多缓冲迁移，行为逐字节保持。
- ✅ **指针失效（已查清，主路径本就安全）**：复核 `BuiltinBridge.resolvePtrGetter/Setter` 后确认——活的 `getXxxPtr` 路径**每次访问都重新 `getPtrFn(e)` 取指针、并重新读 `mod.HEAPF32`**（emscripten 在堆增长时会替换 `Module.HEAPF32`）。所以对重分配与视图失效**都已天然安全**，无需把 version 接进来。RC2 新增的 `SparseSet::version()` 保留为"单一来源"，供未来任何**缓存**指针的调用方复核。真正的残留风险只在个别**缓存** HEAP 视图的子系统读取，属下条范畴。
- ⏳ **RC3 剩余**（较低优先级 / 需 emsdk）：
  1. C++ 边界校验始终开启（不被 release 的 `ES_ASSERT` 剥离）——生成的 embind 包装已有 `valid(entity)` 守卫，需审计补齐其余入口（C++ harness 可验证）。
  2. 各子系统桥接（physics/spine/tilemap/timeline）调用前接 `throwIfModuleAborted` + 缓存 HEAP 视图处改为每次重读（目前只有主模块经 BuiltinBridge 装了 abort 守卫）。

### RC5 渲染唯一路径 — ✅ 渲染/GPU 部分已落地（SDK 部分待续）
**已完成（PR #41–#47，已并入 master）**：
- **GfxDevice 成为唯一 GPU 入口**：Shader/Texture/Framebuffer（`7a2b60f1`）、Buffer/VAO/IndexBuffer + CustomGeometry（`54db2398`）全部经 `GfxDevice`；**single GL boundary**——最后的裸 `gl*` 收口 + CI guard 防回归（`338caff2`，Batch 5b/6）。
- **退役遗留渲染器**：删除 `Renderer`/`BatchRenderer2D`，`ImmediateDraw` 改建在 `TransientBufferPool` 上（`36c357db`，Batch 5）；清理 `RenderContext` 死 quad/shader 资源（`f11087c6`）；bind-coherence（PR #47）。
- **索引 u16→u32**：批渲染索引加宽，消除 >65535 顶点静默回绕（`cb1678ef`）。
- 验证：renderer 头文件已无 `Renderer`/`BatchRenderer2D` 类残留（仅注释引用）；GfxDevice 抽象由 MockGfxDevice harness 守护。

**待续（SDK 侧，本批未做）**：
- **统一 WasmBridge 基类**：SDK 仍只有 `BuiltinBridge`（`sdk/src/ecs/BuiltinBridge.ts:299`），病灶所述"五套桥接写法"尚未收敛到单一基类。
- **全 per-App 状态**：Camera/Timeline/SpriteAnimator/postprocess 等进程级全局是否已迁 per-App 资源，待审计确认。

### 地基收口（Foundation Consolidation）— 📋 已立项，RC6 前置（设计文档）
见 [`REARCH_FOUNDATION_CONSOLIDATION.md`](./REARCH_FOUNDATION_CONSOLIDATION.md)：F2 单一 `WasmBridge` 基类 + abort 守卫下沉（keystone）、F3 全 per-App 资源、F1 平台后端接缝（**保留 native 但隔离**，已拍板）、F4 重写 `ARCHITECTURE.md`。执行先于 RC6。

### RC6 资产管线 — 📋 已立项（设计文档）
见 [`REARCH_RC6_ASSETS.md`](./REARCH_RC6_ASSETS.md)：面向微信/移动端的资产管线根治——GPU 压缩纹理（keystone）、内容寻址身份、显存预算 + LRU 驱逐、运行时分包/流式 + 微信分包映射。属"能力/平台错配"根治，区别于 RC1–RC5 的"正确性根因"。
