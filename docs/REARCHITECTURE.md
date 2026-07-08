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

### RC3 错误/生命周期 — ✅ 已全部收口（2026-07-07 边界校验常开落地）
错误模型已定：**保持 `-fno-exceptions` + 显式状态 + onAbort 死亡标志**（不增体积/不降速）。
- ✅ **错误通道（已完成）**：新增 `moduleHealth.ts`——`WasmModuleAborted` + 按模块的死亡标志 + `installAbortGuard`（挂 emscripten `Module.onAbort`，保留既有 handler）。`handleWasmError` 对 `WasmModuleAborted` **重抛不吞**（abort 是终态，吞掉就是继续调用尸体）。`BuiltinBridge` 在 `connect` 装守卫，并在唯一收口 `resolveAndCache_` 把四个边界方法包成"调用前短路 + 调用中 abort 则致命重抛"。验证：typecheck + 8 个新测试 + 全套 2020 测试通过。
- ✅ **RAII `_malloc`（已完成）**：新增 `wasmScratch.ts`——`withScratch(mod, alloc => …)` / `withMalloc`，作用域内分配的所有缓冲在回调返回**或抛异常**时按逆序释放。把 9 个文件的全部瞬时分配站点（runtimeLoader、TextureLoader、PhysicsSystem×3、TimelineUploader×6、ModuleBackend、SpineController×4、tilemapAPI×3、tiledLoader×4、TextRenderer）迁到该助手；持久缓冲（material/draw/renderer/geometry 的 alloc-once）与已有 try/finally 的站点不动。验证：5 个新 helper 测试 + typecheck + 全套 2025 测试；逐一人工复核 TimelineUploader/SpineController 等复杂多缓冲迁移，行为逐字节保持。
- ✅ **指针失效（已查清，主路径本就安全）**：复核 `BuiltinBridge.resolvePtrGetter/Setter` 后确认——活的 `getXxxPtr` 路径**每次访问都重新 `getPtrFn(e)` 取指针、并重新读 `mod.HEAPF32`**（emscripten 在堆增长时会替换 `Module.HEAPF32`）。所以对重分配与视图失效**都已天然安全**，无需把 version 接进来。RC2 新增的 `SparseSet::version()` 保留为"单一来源"，供未来任何**缓存**指针的调用方复核。真正的残留风险只在个别**缓存** HEAP 视图的子系统读取，属下条范畴。
- ✅ **边界校验常开（2026-07-07 收口）**：全边界审计确认——实体路径已全闭环（EHT 生成包装的 `valid/has` 门 + Registry/SparseSet 的 `ES_VERIFY` 常开守卫使"无守卫的实体解引用"入口为 **0**；顺带补齐 `getOrEmplace` 缺失的 `ES_VERIFY(valid)` 不对称）。真正的缺口是 **26 个裸指针+长度入口**（JS 传 `uintptr_t`+count 直接 `reinterpret_cast`，坏 count 在写路径可致沙箱内堆损坏）——新增 `bindings/BoundarySpan.hpp` 单一收口：`boundarySpan<T>(ptr, count, what)` 常开三重校验（空指针、`count*sizeof` 溢出、**wasm 线性内存范围** `emscripten_get_heap_size()`），失败记日志并拒绝整个调用。已应用到 Renderer（spine/text 提交、两处矩阵、物理批同步、mesh2d）、Geometry（init/indices/update/两处 transform + `draw_meshWithUniforms` 记录游走越界修复）、Tilemap（5 入 3 出）、sdfFromAlpha、ImmediateDraw、ResourceManager（3 处，含 `rm_createTextureEx` 无视 `pixelsLen` 的过读修复）、physics side module（多边形/链条 + 链条点数上限）。验证：新 `tests/bindings/test_boundary_span.cpp`（emscripten 下测真实堆界）+ registry_safety + 7 个 headless 场景（sprite/text/tilemap/mesh2d/粒子/后处理/spine 全部经过被改路径）全 PASS。
- ✅ 各子系统桥接 abort 守卫：随 F2 统一 `WasmBridge` 基类落地（全子系统覆盖）。

### RC5 渲染唯一路径 — ✅ 渲染/GPU 部分已落地（SDK 部分待续）
**已完成（PR #41–#47，已并入 master）**：
- **GfxDevice 成为唯一 GPU 入口**：Shader/Texture/Framebuffer（`7a2b60f1`）、Buffer/VAO/IndexBuffer + CustomGeometry（`54db2398`）全部经 `GfxDevice`；**single GL boundary**——最后的裸 `gl*` 收口 + CI guard 防回归（`338caff2`，Batch 5b/6）。
- **退役遗留渲染器**：删除 `Renderer`/`BatchRenderer2D`，`ImmediateDraw` 改建在 `TransientBufferPool` 上（`36c357db`，Batch 5）；清理 `RenderContext` 死 quad/shader 资源（`f11087c6`）；bind-coherence（PR #47）。
- **索引 u16→u32**：批渲染索引加宽，消除 >65535 顶点静默回绕（`cb1678ef`）。
- 验证：renderer 头文件已无 `Renderer`/`BatchRenderer2D` 类残留（仅注释引用）；GfxDevice 抽象由 MockGfxDevice harness 守护。

**待续（SDK 侧，本批未做）**：
- **统一 WasmBridge 基类**：SDK 仍只有 `BuiltinBridge`（`sdk/src/ecs/BuiltinBridge.ts:299`），病灶所述"五套桥接写法"尚未收敛到单一基类。
- **全 per-App 状态**：Camera/Timeline/SpriteAnimator/postprocess 等进程级全局是否已迁 per-App 资源，待审计确认。

### 渲染后端抽象（RHI 现代化）— ✅ 已落地（2026-07-06，`6d48beba`→`aec698d3` 四批）
在 RC5"唯一入口"的基础上，把 `GfxDevice` 从 GL 味接口升级为后端中立 RHI，使未来 WebGPU/原生后端可平行接入而 Renderer 层零改动：
- **类型化句柄 + 描述符创建**：`Buffer/Texture/Shader/Framebuffer/VertexLayoutHandle` + `*Desc`（GL 后端句柄值=GL id，零开销）；bind-target 上传协议、`texImage2D`/`pixelStorei` 等 GL 形状全部退出接口；`bindBufferBase`→`setUniformBuffer(slot, handle)`（未来 BindGroup 接缝）；GPU 计时查询下沉（顺带修复 profiler 泄漏到 `RenderFrame.cpp` 的裸 `gl*`，boundary guard 恢复绿色）。
- **顶点布局进 Pipeline、VAO 内化**：`VertexLayoutDesc`→`PipelineDesc.vertexLayout`，per-draw `setVertexBuffer(slot, buffer, offset)`/`setIndexBuffer`；GLDevice 按布局持有惰性 re-point 的 VAO 缓存（粒子实例流 rebase 语义保持）；删除 `VertexArray` 包装类；`draw_mesh`/PostProcess/ImmediateDraw 全部改走真 pipeline。
- **RenderPass**：`beginRenderPass(desc)`/`endRenderPass` 收拢 FBO 绑定 + clear（load-op 语义：强制写掩码，修复"上帧末尾 stencil-write pipeline 会静默吞掉 clear"的潜在 bug）；`bindFramebuffer` 退出公共接口。TS 驱动的主 pass clear 保留在边界（多相机 scissored clear 依赖），文档标注为 WebGPU 后端的 deferred-load-op 仿真点。
- **散装状态 setter 全部转 GLDevice 私有**：公共动态状态只剩 scissor + stencil reference（与 WebGPU 划分一致）。
- 验证：MockGfxDevice 四套 harness、web 构建、GL boundary guard、六个 headless 渲染场景（精灵/UI 模板遮罩/后处理链/实例化粒子/Lit 材质/tilemap）+ 编辑器截图（网格 draw_mesh 路径）全绿。
- ~~**遗留**：散装 `setUniform*`（自定义网格 + 后处理路径）仍是 GL 式 per-program uniform~~ — **✅ 已迁 UBO（2026-07-06，`4c538529`，DrawParams）**：`rewriteLooseUniforms`（renderer/DrawParams）在 `ResourceManager::createShader` 咽喉点把两 stage 的散装非 sampler uniform（float/int/vec2-4/mat3/mat4，单声明符）提升为共享的 `layout(std140) uniform DrawParams` 块（binding 4；0=Frame 1=Material 2=Light 3=Time）；`Shader::setUniform` 保持原作者面，成为 facade——命中块成员写入 CPU 影子（std140 偏移，mat3 展开 vec4 stride），sampler 落回散装路径，`hasUniform` 认块成员；`commitParams()` 脏则上传、每 draw 必绑（后处理 renderPass/blit、draw_mesh(+WithUniforms) 提交）。安全网：GLSL ES 1.00 源跳过（UBO 需 300 es）、提升后编译失败回退原源重试、RenderContext 每 pass 在 binding 4 预绑 4KiB 零 fallback（未提交路径读零=旧散装默认，且满足 WebGL bound-range 检查）。`compileEsshader` 显式豁免（参数已在 MaterialConstants）。编辑器网格 shader 移植 300 es 成为生产消费者（2×mat4+3×float+4×vec4 全走一个 UBO）。验证：`tests/renderer/test_draw_params.cpp`（39 检查，MockGfxDevice 断言无散装上传）+ verify 战役（sprite 逐位一致/postprocess/粒子渐变+尺寸曲线/mat-lit-point/mat-graph）+ 编辑器截图（网格经 UBO 渲染无 shader 错误）+ GL boundary guard + SDK 2791/desktop 410/双侧 tsc 全绿。**尚余（WebGPU 前最后两片）**：① TS 驱动主 pass clear → deferred load-op；② GLSL-only `createProgram` → WGSL 通路（DrawParams 块重写已定义 WGSL 需发射的形状）；之后 RHI 的 `setUniform2f/3f/4f/Mat3/Mat4` 可裁（只剩 sampler 1i + 引擎内嵌路径）。

### 渲染统一命令面（Unified Render Pipeline）— ✅ 已落地（2026-07-07）
RC5"渲染唯一路径"的收官：所有 Renderer 只**生成命令**，Sort/Merge/Batch/Submit 全部统一在 `DrawList`。审计发现命令流架构已存在（六个 plugin + spine/text/tile 直接提交都进同一 `DrawCommand`/`DrawList`），残留的是最后两个手搓命令的 plugin 与四份复制的 collect 前奏：
- **单一命令生产面**：`BatchBuilder.cpp` 成为全仓**唯一**组装 `DrawCommand` 的翻译单元。`BatchDrawKey` 增加 `layoutId`/`instanceCount`；新增布局泛型 `appendIndexedDraw`（任意顶点格式，步长由 `TransientBufferPool::vertexStride()` 单一来源提供，杜绝调用方 sizeof 与设备布局漂移）。ShapePlugin（手搓命令 + 私有 QUAD_INDICES）与 ParticlePlugin（手搓实例化命令）全部改走该面，命令语义逐字段保持（纹理槽规则：Batch 流恒 1 槽白纹理兜底，非 Batch 流无纹理则 0 槽不碰 sampler）。
- **CI guard**：`tools/check-draw-command-boundary.mjs`（对齐 GL boundary guard 模式，接入 build.yml）——`DrawCommand` 组装或 `DrawList` push 出现在 BatchBuilder.cpp 之外即失败。新增一种 Renderer（NinePatch/Trail/Mesh2D…）= 算顶点 + 填 `BatchDrawKey` + append，零底层改动。
- **共享 collect 前奏**：`CameraWorldRect` 由 `RenderFrame::collectAll` 每次 collect 计算一次进 `RenderCollectContext`（此前 Sprite/Shape/Text/Tilemap 四个 plugin 各自求逆 VP 推相机中心/边界）；`parallaxedWorldPosition()` helper（RenderTypePlugin.hpp）收拢 ensureDecomposed + 视差偏移 + "cull 于绘制处"约定。
- **刻意保留的两条即时模式边界**（非场景命令流，不进 DrawList 是语义选择而非欠账）：`ImmediateDraw`（编辑器/调试叠加，自带 flush 时序）与 `draw_mesh` 自定义网格（在 TS 自定义绘制回调期内即时执行，依赖 pre-scene/post-flush 顺序语义）。
- 验证：新增 `tests/renderer/test_batch_builder.cpp`（8 用例 43 断言：各流 baseVertex 步长、纹理槽规则、实例化命令组装、多纹理合并 + texIndex 重写、跨流不合并、clip 盖章、execute 分发）；六套 MockGfxDevice harness、web 构建、11 个 headless 像素场景（sprite / parallax-shape / text-sdf / 粒子×2 / tilemap×2 / ui-mask / lit×2 / postprocess）全 PASS；双 boundary guard 绿。
- **承诺实测 — Mesh2D 场景级 renderer（2026-07-07 第二批）**：`RenderType::Mesh` 从"仅统计枚举"变成真渲染类型。`Mesh2D` 组件（EHT 注解字段 + **未注解的变长几何 payload 置尾**——变长数据无固定 ABI 偏移，天然不进指针布局/断言）；几何经唯一入口 `mesh2d_setGeometry` 上传（索引越界整体拒绝 + AABB 计算）；`MeshPlugin` 全部内容 = 共享前奏 + SpritePlugin 同款材质/lit 解析 + CPU 仿射变换 + `appendIndexedBatch`——**零底层改动**，网格自动获得排序/裁剪/clip/多纹理合并/Lit2D。SDK：`Mesh2DAPI`（withScratch 批量上传）+ 场景 out-of-band codec（`geometry` 字段随 .esscene 声明式携带，particle 渐变同模式）。刻意不做：GPU 驻留网格（2D 网格顶点量小，CPU 流式与 sprite/tilemap 同模型；大网格属未来 3D 议题）。验证：mesh2d headless 场景（双三角逐顶点色，3 像素断言）一次过 + 回归 5 场景 + SDK/desktop 双侧 tsc + 全套测试 + 24 examples + 双 guard 全绿。

### 渲染 clear → deferred load-op（WebGPU 前两片之①）— ✅ 已落地（2026-07-07）
TS 驱动的主 pass clear 退出边界，`clear` 家族退出公共 RHI：
- **RenderPassDesc 携带全部 load-op 值**：clear 颜色、stencil 值、可选区域（`clearW==0` = 整目标；GL = scissored clear，WebGPU 后端整目标映射真 load-op、区域用首 pass load-op 或 clear-quad 仿真）。`beginRenderPass` 自含 scissor 状态（scoped 用自己的矩形，非 scoped 强制关——真 load-op 覆盖整个附件，不被上一帧残留 scissor 否决）。
- **clear/setClearColor/setClearStencil 降为 GLDevice 私有**；唯一例外是新的窄接口 `GfxDevice::clearStencil(value)`——mask pass 的**中帧** stencil 重置（不能重启 pass：场景可能正渲进后处理捕获；WebGPU 仿真 = stencil-write quad）。
- **`renderer_begin` 携带 clear**（flags/rgba/区域），`renderer_clearBuffers`/`renderer_setScissor`/`renderer_clearStencil`（零调用方）三绑定退役；TS `renderPipeline` 删除 setScissor+clearBuffers 舞蹈，Canvas 背景色经 `CameraRenderParams.clearColor` 直达 pass——顺带根治 **sticky 颜色 bug**（`renderer_setClearColor` 只写 ctx state，相机路径的背景色从未到过设备）。
- **根治了第二个双实例病灶**：TS `postprocess_*` 绑定用 ctx 服务里懒创建的 `PostProcessPipeline`，而 `RenderFrame::init` 自建私有实例——两份状态各自漂移（正是 begin 改造后主 pass 目标判断失灵、后处理全黑的根因）。修复：EstellaContext 把 RenderFrame 的实例以借用方式注册为服务（`registerService`），单实例、单一状态归属。
- **方法论教训（已入记忆）**：排查期间多次实验跑在陈旧 wasm 上导致结论互相矛盾；现在的协议是每轮 bisect 在源里嵌标记字符串、grep 部署产物 + 比对双份 md5 后才采信结果。
- 验证（全部本地、BelowNormal）：13 个 headless 场景全 PASS（含 postprocess-effects/lut-grade 两个后处理场景、mesh2d、ui-mask、lit×2）；6 套 MockGfxDevice harness、SDK 241 测试文件（renderer/renderPipeline 测试更新为 load-op 契约）、desktop 63 文件、双侧 tsc、24 examples 全绿。**WebGPU 前仅剩一片**：GLSL-only `createProgram` → WGSL 通路。

### WGSL/WebGPU 通路 — 🟡 Phase 0-3 全部完结 + SDK 启动 + custom-draw 现代化；剩 Phase 4 cook 期用户材质（2026-07-08）
**Phase 2 收官（切片 5a/5b）**：深度/模板全通（surface 伴随 DS 纹理、管线按 pass DS 形状惰性变体、clearStencil 中帧仿真、采样器参数缓存 + group-1 纹理/采样器 8+8 配对）；引擎初始化流接入（`EstellaContext::init(Unique<GfxDevice>)`，后端选择留在平台边界零 #ifdef）+ `webgpu_engine_bringup` 真 ECS 场景两后端逐点 diff=0。
**Phase 3 完结（切片 1-6，2026-07-07 单日）**：显式绑定布局（掩码缓存 BGL + 哑资源回填，纹理槽 8→16）；`.esshader` `#pragma vertex/fragment wgsl` 孪生段 + 注入头双语发射（块变量移植规则 tc/mc/lc、std140≡WGSL 布局、feature 迷你预处理器）；batch/shape/particle 内嵌归位单路径；7 模板 + 3 滤镜 + 13 后处理效果全部双语（PP 参数迁反射 MaterialConstants per-pass UBO，`u_resolution` 退役）；materialGraph 单 DAG 双语发射。
**SDK 启动 + resize（campaign coda）**：web 变体带 WebGPU 后端（wechat/playable 保持 GL 零胶水体积）、`WebAppOptions.backend`、`ESTELLA_VERIFY_BACKEND=webgpu` 场景断言像素精确相等、`GfxDevice::resizeBackbuffer` 每帧契约（WebGPU swapchain 重配）。
**Custom-draw/Draw API 现代化（2026-07-08，最后一个 GL-only 通路闭合）**：新绑定 `draw_meshWithMaterial`——反射材质（compileEsshader）经 `MaterialStore::bindForDraw` 走 MaterialConstants（binding 1）+ 材质记录供给全部管线态，两后端同路零散装 uniform；TS 侧 18 名字 loose 表退为 raw-GLSL `createShader` 兼容路径。编辑器网格迁双语 `.esshader`（`u_model`→`u_rect` 参数 + authored vertex 声明 FrameConstants）——**WebGPU 下编辑器网格首次渲染**，GL/WebGPU 帧一致；`ESTELLA_VERIFY_GRID` 双后端 on/off 像素 diff 断言入 harness。
**WebGPU 异步 readback seam（2026-07-08，后端不对称性收口）**：同步 `readPixels` 退出 RHI，全接口统一为异步四段 `requestReadback / pollReadback / takeReadback / discardReadback`（GL = 请求时同步读、首 poll 即 Ready；WebGPU = `copyTextureToBuffer` → 256 对齐 staging + `mapAsync(AllowSpontaneous)`，跨事件循环 turn 落地；行序统一 bottom-up 契约在 take 时翻转）。RenderFrame 的两个消费者（材质预览 renderToTarget、帧调试器 replayToDrawCall）改为 pass 关闭后请求 + `pollPreview/SnapshotReadback` 落地（顺带修 snapshot 尺寸 getter 读当前帧而非快照时尺寸的隐患）；TS 侧 `Material.renderPreview`/`Renderer.getSnapshotImageData` 转 Promise（`readback.ts` 单一 poll 循环，双后端同码）。离屏色纹理补 `CopySrc` usage。**材质预览断言在 WebGPU 下点亮**：mat-tint 场景（补了手写 WGSL 孪生的用户 `.esshader` 资产）双后端 EXPECT + PREVIEW 像素精确 PASS——顺带证明场景资产 shader 带孪生即可整链上 WebGPU。
**Phase 4 转换管线（2026-07-08）**：用户 `.esshader` 的 GLSL→WGSL 自动孪生落地——`tools/gen-shader-twins.mjs`：引擎 wasm 新绑定 `esshader_cookInfo`（web glue 可在纯 Node 加载）吐出与运行时逐字节一致的装配后 GLSL + 纹理单元反射（零漂移），经方言适配（310 es、precision 全 highp、显式引擎绑定注入、combined sampler 拆对、函数采样器参数/实参拆分、varying location 按名对齐）→ `glslangValidator -V` → `naga` → 自包含 `#pragma vertex|fragment wgsl full` 孪生段（ShaderParser 新语义：full 段跳过全部注入头）。9 个 fixture shader 批量生成后，mat-lit 系/mat-tex/mat-dissolve/mat-graph/mat-builtin-lit/mat-instance **在 WebGPU 全部从全黑转绿，lit 像素与 GL 逐点一致**（15 场景 battery）。带 `#pragma switch` 的 shader 跳过（排列需逐集合，手写孪生）。
**剩余**：cook 管线集成（cookAssets 挂钩 + 转换器 vendored wasm 交付，前置 = RC6 资产依赖图两个存量缺口：assetDb 不扫 .esmaterial 引用、collectRefs 只认 @uuid: 不认路径引用）；CI 无 WebGPU 适配器（webgpu verify 仅本地）。
见 `REARCH_WGSL.md`（本地 gitignore，同 RC6/2D_PARITY 约定）：着色器版图盘点（uniform 数据已全后端中立，剩程序文本）、岔路拍板（有限集人工孪生 / 图材质 AST 双发射 / 用户材质 cook 期转换——拒绝运行时翻译器的 MB 级体积代价）、四期计划（源语言接缝 → WebGPUDevice 原型 → 双语发射 → cook 期用户材质）。**Phase 0 已落地**：最后 3 个 GLSL ES 1.00 残留（SDK outline/drop-shadow/color-matrix 滤镜）重写为 fragment-only `.esshader` 反射路径——顺带修复其设计性破损（raw 形态无 `u_projection` 来源、无属性绑定、mat4 超 `setMaterialUniform` 的 vec4 上限**从未能传入**；色彩矩阵改为 4×vec4 行 + 偏移列，新增 `Filters.colorMatrixUniforms` 助手）。全仓每个程序自此都在现代缝上（300 es + UBO 反射）。
**Phase 1（源语言接缝）已落地**：RHI 补上最后一块后端中立拼图——`createProgram` 收语言标签的 `GfxShaderSource`，新增 `supportsShaderLanguage` 能力查询（GL = 仅 GLSL ES 300；`Shader::compile` 在任何 GPU 调用前对不支持的语言快速失败）；语言贯穿 Shader/ResourceManager（DrawParams 重写仅对 GLSL 生效）；`ShaderParser::assembleStage` 获得 `ShaderTargetLanguage` 参数（WGSL 发射 = Phase 3）。MockGfxDevice 新增 `wgslSupported` 开关 + 语言门用例；行为零变化（8 harness + 场景抽样等价）。
**Phase 2 切片 1（WebGPU 后端启动）已落地**：emdawnwebgpu 端口（Dawn）集成为测试目标独立依赖（主构建零影响）；`renderer/webgpu/` 新增纯映射层（GfxEnums→WGPU 全翻译，blend/模板表镜像 GLDevice 语义，load-op 规则与 RenderPassDesc 契约一致）+ 空设备安全的 `WebGPUDevice` 骨架（缓冲/纹理/WGSL 模块真实现，布局/管线描述符保留待惰性构建，pass/draw 为切片 2 结构化桩）；`test_webgpu_device` 用真 Dawn 头编译验证全部描述符拼写，入 CI。
**Phase 2 切片 2（首帧点亮）**：WebGPUDevice 长出真渲染路径——canvas 表面（页面 JS 异步取 GPUDevice 经 `Module.preinitializedWebGPUDevice` 交接，wasm 全同步零 Asyncify）、帧编码器（load-op 直译 RenderPassDesc）、惰性 pipeline（映射层直译 + 描述符去重）、group-0 UBO bind group、索引/实例化 draw。bring-up：electron 驱动 `webgpu_bringup.wasm` 用引擎同款 RHI 调用序列渲染 **shape.esshader 的 WGSL 孪生**——首次运行即像素级 PASS（SDF 红圆 + 清屏色逐像素命中，零校验错误）。本地命令：`node desktop/scripts/webgpu-bringup.mjs`（CI 暂不跑真 GPU bring-up；null-device 套件在 CI）。
**Phase 2 切片 3（纹理组）**：group-1 约定（8×`texture_2d` binding 0..7 + 共享 sampler binding 8 = `u_textures[8]` 的 WGSL 拼写；未用槽重复 slot-0 视图同 WebGL2 规则；group 1 仅在 pass 内绑过纹理时设置、每 pass 重置）；**batch 默认变体 WGSL 孪生**（`textureSampleLevel` 保 uniform-flow）。bring-up 两幕同 pass（shape + 批双 quad texIndex 选择）再次首跑 PASS——sprite 管线的核心机制（逐顶点采样槽选择）在 WebGPU 上验证通过。
**Phase 2 切片 4**：offscreen 目标（createFramebuffer→pass 以附件视图为目标）+ **区域 clear 仿真兑现**（内部全屏三角管线 + 区域 scissor，load-op 契约"区域=Load+仿真"自此在两个后端都有真实现）。bring-up 三 pass：离屏清绿→主双幕（右 quad 采样离屏渲染结果 = render-to-texture 验证）→区域黄 clear，五点像素断言全中零校验错误。

### CI 常绿门禁（push-gated invariants）— ✅ 已落地（2026-07-07）
此前 `build.yml` 仅 `workflow_dispatch`——boundary guards、全组件 ABI `static_assert`、各测试套件全是"约定"而非"机制"。现在**每次 push master 自动跑**：① web/playable/wechat 构建（编译期即验证生成断言 + ABI 哈希）+ 全部 15 个 C++ doctest harness（node 下执行）；② 双 boundary guard + SDK tsc/构建/vitest + examples 检查 + desktop tsc/vitest（后两者此前完全不在 CI）；③ headless 像素验证（sprite/mesh2d/parallax-shape/tilemap-flip/ui-mask，electron + xvfb + SwiftShader，需 `ELECTRON_DISABLE_SANDBOX`）。落地即抓到并修复三处腐化：`test_registry.cpp` 用已删除的 `View::sizeHint`、`test_sparse_set.cpp` 的局部常量撞 emscripten `PAGE_SIZE` 宏、以及一个**真回归**——单组件 `View::each` 活迭代（中途 emplace 会重访、swap-pop 移除会跳漏），多组件版早有快照契约，现已对齐。

### 地基收口（Foundation Consolidation）— 🟡 进行中，RC6 前置（设计文档）
见 [`REARCH_FOUNDATION_CONSOLIDATION.md`](./REARCH_FOUNDATION_CONSOLIDATION.md)：
- **F2 单一 `WasmBridge` 基类 + abort 守卫下沉（keystone）— ✅ 已落地**（`ac390f7d` + RM 闭环 `41bea17a`，五套桥接全部收敛，abort 守卫全子系统覆盖）。
- **F3 全 per-App 资源 — ✅ 已落地**（分支 `rearch/f3-per-app`）：Camera（`CameraView`）、Timeline（`Timeline`）、PostProcess（拆 god-object + 管线注入 + 删 sync.ts）、SpriteAnimator（`SpriteAnimation`）全部 per-App;模块绑定单例在单模块运行时下无需改（B4 关闭）。
- **F4 重写 `ARCHITECTURE.md` — ✅ 已落地**：`docs/ARCHITECTURE.md` 重写为当前现实（`RenderFrame`+`GfxDevice`/`GLDevice` 单一 GPU 边界、单一 `SparseSet`+`version()`、按域 TypeId、per-App 资源 + `WasmBridge` 基类、`ResourcePool` LRU/预算），删除对已删除的 `Renderer`/`BatchRenderer2D` 的描述。
- F1 平台后端接缝（**保留 native 但隔离**，已拍板）— ⏳ 待做。

执行先于 RC6。

> **能力对标路线**：RC1–RC5 修正确性、F/RC6 修地基与平台错配之外，"能力缺口对标"（交付管线 / 内容创作闭环 / 渲染深度 / 完整度）的优先级与执行顺序见 [`REARCH_2D_PARITY.md`](./REARCH_2D_PARITY.md)（本地 gitignore）。

### RC6 资产管线 — 📋 已立项（设计文档）
见 [`REARCH_RC6_ASSETS.md`](./REARCH_RC6_ASSETS.md)：面向微信/移动端的资产管线根治——GPU 压缩纹理（keystone）、内容寻址身份、显存预算 + LRU 驱逐、运行时分包/流式 + 微信分包映射。属"能力/平台错配"根治，区别于 RC1–RC5 的"正确性根因"。
