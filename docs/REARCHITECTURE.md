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

### RC2 / RC3 / RC4 / RC5 — 未开始
按执行顺序依次推进，全程在 RC1 的 `static_assert` + 握手护栏内进行。
