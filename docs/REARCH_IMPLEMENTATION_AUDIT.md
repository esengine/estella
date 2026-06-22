# Estella 实现质量债审计（Implementation Quality Audit）

> 目标读者：引擎维护者 / AI 协作代理。
> **与 RC 文档的区别**：`REARCHITECTURE.md`（RC1–RC5）、`FOUNDATION_CONSOLIDATION`、`RC6_ASSETS`、`REARCH_FRONTIER.md`（RC7–RC11）描述的是**主动识别的根因**与**新能力规划**；本文是对**已实现、正在运行的代码**的一次全面质量体检——找出"能跑、但实现得糙 / 有裂缝 / 有空腔 / 该重构"的债。
> 方法：2026-06 四路并行只读审计（设计 / 完成度 / 性能 / 健壮性）+ 逐条行号核实 + 误报剔除。
> **重要免责**：A 类多为审计**推断**的缺陷（已核实行号与逻辑，但**未运行复现**）。执行时应**先写复现/回归测试确认，再修**，不可凭本文盲改。
> 已排除 RC1–RC11 全部已修复 / 已规划项，下列均为**其之外**的剩余债。

---

## 0. 核心诊断：三类债 + 一个放大器 + 一条贯穿线

### 放大器（根因级）：`ES_ASSERT` 在 release/WASM 下编译为空操作
`core/Log.hpp:316` —— `ES_ASSERT` 在生产构建展开为 `((void)0)`。后果：所有"靠 assert 兜底"的边界 / 成员资格 / 大小 / 溢出检查，在**出货版本里全部消失**，坠入未检查的 fall-through。开发期 assert 拦住的，生产期就是 OOB 读 / abort / 静默损坏。**A 类多项的严重度由此抬高。**

> 系统性修复建议：把"必须始终生效"的边界检查从 `ES_ASSERT` 剥离为独立的、release 也保留的运行时守卫（与 RC3 "边界校验始终开启" 同精神，但 RC3 只覆盖了 JS→C++ 的 embind 入口，**引擎内部调用点未覆盖**）。

### 一条贯穿性能债的线：有机制却没接上用
难的（SIMD / 并行 / 批合并）已在 RC7–RC8 规划；本审计发现的性能债集中在另一类——**dirty / 缓存 / 复用机制已存在，却没被调用**：`rebuildIfDirty()` 不调而走无条件 `rebuild`、`Shader::uniformCache_` 被绕过、`sort_entries_` 间接排序却又物化深拷贝、wasm 真值源之外又维护一份 JS Set。多为低-中风险、改动局部、收益直接。

### 一类最危险的债：功能静默缺失（不是死代码，是"以为有其实没有"）
比死代码更危险——代码看似实现了某功能，但**从未接到运行路径**，用户/上层以为它在工作：活地图无碰撞体、UI 行为层不 tick、微信音量控制 no-op、material 缓存失效 no-op。见 B2。

---

## A. 正确性裂缝（会崩溃 / 内存损坏 / 资源泄漏）

### A-Critical（确定的 abort / OOB / UAF，优先堵）

| # | 位置 | 缺陷 | 触发 | 后果 | 修复 |
|---|---|---|---|---|---|
| A1 | `core/Log.hpp:244` | `std::stoi` 解析浮点格式精度，`-fno-exceptions` 下抛即 abort | 格式串以 `f` 结尾含 `.` 但精度段非数字/空，如 `"{:.f}"` | **整个 WASM 模块挂死** | 改 `std::from_chars`，失败跳过精度 |
| A2 | `renderer/Texture.cpp:166-174` | `setDataRaw` 把 `sizeBytes` `(void)` 丢弃，按全尺寸 `texSubImage2D` | 调用方传入小于 `w*h*bpp` 的 buffer | **越界读 WASM 线性内存** | 运行时校验 `sizeBytes`，不足早退 |
| A3 | `bindings/SpineModuleEntry.cpp:589,631+` | `currentBatch` 裸指针指入 `meshBatches` vector，后续 `emplace_back` 扩容搬迁后继续写 | 任意 ≥2 batch 的骨骼 | **use-after-free 写 / 堆破坏** | 改存 `batchIndex` 整型，用时重解析；或预 `reserve` |
| A4 | `bindings/SpineModuleEntry.cpp:184,193` | `spSkeletonBinary/Json_create` 返回 null 未检查即解引用 | spine-c 分配失败 / 损坏数据 | null 解引用 UB | 解引用前判空，失败返回 -1 |
| A5 | `text/BitmapFont.cpp:133,156` | `createLabelAtlas` 整数除零（`charWidth==0` 或 `texWidth<charWidth`） | 数据驱动的图集描述 | **WASM trap，模块 abort** | `cols==0 \|\| charWidth==0` 早退 |
| A6 | `ecs/SparseSet.hpp:193`、`ecs/Registry.hpp` `get<T>` | release 下唯一守卫 `ES_ASSERT(contains)` 消失，`denseIndexOf` 返回 `0xFFFFFFFF` 被当下标 | 对不持有组件的实体 `get<T>`（`UILayoutSystem.cpp:72` 等 `get<UIRect>(parent)`） | **无界 OOB 读 → 静默损坏/崩溃**（引擎内最大 OOB 源） | `get` 走 release 也生效的范围检查；热路径用 `tryGet` |

### A-High（生命周期 / 泄漏 / 静默损坏）

- **A7 重入 `destroy` 计数下溢 + 索引双回收** `ecs/Registry.hpp:137-167`：`onDestroy` 内递归 destroy 同实体，内外层各 `--entity_count_`（usize 下溢）+ 同 idx 两次入 `recycled_` → 未来 create 发出别名 entity。修：回调前先标失效。
- **A8 `View<T>::each` 单组件特化不快照** `ecs/View.hpp:421-437`：持 `pool_->entities()` 引用，回调内 emplace 扩容即悬垂 / remove swap-pop 漏访。多组件版有快照，单版没有，**行为不一致**。修：单版同样快照 + 复检。
- **A9 层级递归无深度/环守卫** `TransformSystem.hpp`（`destroyWithChildren:223`/`isDescendantOf:151`/`getRoot:214`）、`UITree::buildDFS`：裸 `emplace<Parent>` 可造环 → 无限递归 / 栈溢出 trap。修：深度上限 + visited 集。
- **A10 `ResourceManager` 所有 create* 裸解引用 `*device_`** `resource/ResourceManager.cpp:63,127,274`：init 前 / shutdown 后调用 → null 解引用或 UAF。修：`!initialized_` 早退，shutdown 置 `device_=nullptr`。
- **A11 Spine 资源生命周期**：`texture_handles_` 按去重后 handle id 作 key → 共享条目被提前/双重释放（`SpineResourceManager.cpp`）；`loadJson/loadBinary` 成功但 `pool_.get==null` 时局部 atlas 析构却仍缓存 → 渲染时 UAF。
- **A12 `ParticleSystem` 注册捕获 `this` 的 onDestroy 永不移除** `particle/ParticleSystem.cpp:12-17`：系统先于 Registry 析构后回调悬垂 this。修：析构 `removeOnDestroy`。
- **A13 Physics 关节生命周期** `bindings/PhysicsJoints.cpp:35,144`：`entityToJoint[B]` 单端 key → 同 B 再建关节旧句柄泄漏；destroy body A 留悬垂 map 条目。
- **A14 Tilemap 越界 / 截断**：`setChunkTiles` 源索引用未裁剪 `width`（`TilemapSystem.cpp:92`）OOB 读；`convertGid` 双重截断把大 gid 静默映射成错 tile（`TiledMapLoader.cpp:114`）；Tiled 有符号 count 未检查（`:197`）负转 u32 巨大 → bad_alloc/OOB。
- **A15 渲染器错误契约形同虚设** `Texture.cpp:131`：`initialize()` 恒返回 true，失败路径死代码，OOM 时返回包裹 id 0 的"有效"纹理（静默黑屏）；`createFromExternalId` 析构无条件 `deleteTexture`（外部所有者也删 → 双删）；`CustomGeometry::init` 空 layout `stride_==0` 除零。
- **A16 TS：WASM 实例化失败吞掉** `wechatRuntime.ts:89`、`spine/SpineModuleLoader.ts:190`：`.catch` 只 log 不调 `successCallback` → **工厂 Promise 永久挂起**，该路径所有调用挂死。修：透传 rejection + 超时。
- **A17 TS：超时纹理仍上传 → 每次慢加载泄漏 VRAM** `asset/AsyncCache.ts:41`：超时置 `aborted` 但底层继续跑、返回已注册 GL 的纹理被丢弃无人释放。修：`onAbandon` 处置器 / AbortController。
- **A18 TS：Scene `load/unload` 无回滚** `sceneManager.ts:280-391`：load 失败留 `status==='loading'` 尸体，重试解引用 undefined → **场景永久无法重载**；`unload` 的 `config.cleanup` 无 try/catch，抛出则后续 teardown 全跳过 → entity/system/纹理泄漏。
- **A19 TS：Physics/Spine Plugin 无 `cleanup()`** ：native 模块 shutdown 是死代码，`world.onDespawn` 监听注册不移除 → re-init 留陈旧监听。
- **A20 TS：`createTexture()!` 上下文丢失崩 + 错误路径 GL 泄漏** `TextureLoader.ts:188`、`compressed.ts:168`：`!` 断言 null；upload 抛出则纹理不删。
- **A21 TS：Audio 多处** ：`Audio.ts:98` 快速换 BGM 不 stop 旧 handle → 永放泄漏；`AudioPool.ts:52` release 不 disconnect → 音频图累积。

### A-Medium（规模相关 / 静默别名，择要）
- `ResourcePool`/`Registry` 的 index+generation 打包静默溢出（>2^20 条目或槽复用 4096 次后 handle 别名）；`clear()` 把 generation 重置为 0 → reinit 后旧 handle 与新资源别名误判 `valid()`。
- `PhysicsContext.cpp:24` entity 0 存为 `void*(0)` 被当"无 userdata" → entity 0 碰撞/射线静默丢弃（修：存 `id+1`）。
- Box2D create 返回值从不校验、多边形/链顶点无上界校验（bad_alloc abort）；`getEventRecord(i32)` 无界索引 OOB。

> 已核实为**非问题**（避免误修）：`TilemapRenderPlugin.cpp:177` 在 `const auto&` 上写 `dirty` 是有意的 `mutable` 渲染缓存（`ChunkData::dirty` 声明 mutable + collect 非 const），**不是 const 违规**；Texture/Buffer/Shader 的 move 语义干净、shader 编译失败路径正确清理、Framebuffer 完整性检查在位。

---

## B. 空腔（死代码 + 半成品）

### B1：可直接删的死代码（低风险，缩小地基面积）

**C++ 整块死岛**（无 embind 暴露，删除干净）：
- `platform/` 抽象岛：`Platform`/`WebPlatform`（`Platform::create` 零调用 → 从不构造，20 虚函数全死）、`Input` 类、`PathResolver` 全套、`FileSystem` 16 个方法死 15（仅 `readBinaryFile` 被 `SpineExtension.cpp:27` 用，保留）。宣传的热重载/文件监视从未实现。
- `resource/` 死面：可插拔 loader 子系统（`ResourceLoader.hpp` + `LoaderRegistry.hpp` + `ResourceManager::registerLoader/getLoader/...` + `loaderRegistry_`，无任何子类）、`Resource.hpp`（零 include）、GUID 纹理缓存（`loadTextureByGUID/...` + `guidToTexture_`）、VBO/IBO 工厂、`ResourceStats`、`SharedHandle` + 三别名。
- `core/Engine.hpp`+`.cpp` 整个 `Engine`/`EngineVersion`（编译但从不实例化，仅文档引用）、`Types.hpp:263` `Result<T,E>`、`RuntimeConfig` 热重载残留、`Math.hpp` 死函数（`lookAt`/`eulerToQuat`/`quatToEuler` 等，quat 在 TS 侧做）。

**渲染死项**：6 个死 `.esshader`（axis/color/gizmo/grid/sprite/ui，运行时只用 batch+shape）+ 对应 `ShaderEmbeds.generated.hpp` 条目、`Shader.hpp` 的 `EXT_MESH_*` ES1.0 遗留、`renderer/TextureSlotAllocator.hpp` 整文件、`RenderContext` stats 链、一组零调用 getter（`Framebuffer::getSpecification`、`RenderTarget::getSize`、`TransientBufferPool::vboId` + 永不产出的 `LayoutId::MatSprite`）、`GfxEnums.hpp` 死枚举值。

**ECS / 动画死项**：5 个未用 tag 组件（`Common.hpp` `Active/Visible/Static/MainEntity/Folder`）、`Script.hpp` 整文件 + ScriptComponent 集群（TS 用自己的 ScriptStorage）、`Registry::restore/sort<T>`、`View::getAll`、`Glyph::page`（write-only）、`TweenData::group_id`。

**~28 个死 embind 绑定**（JS 零调用，仅 `wasm.ts` 声明）：`renderFrame`/`renderFrameWithMatrix`（旧整体入口）、6 个空 `renderer_submitXxx` stub、12 个 Tiled object-group 绑定（`tiled_getObjectGroupCount/...`，TS 走纯 JS `parseTmjJson`）+ 连带 C++ `TiledObjectInfo` 结构、postprocess 6 个、resource refcount getter、UI patch/dirty/anim-override 一组、`physics_hasBody/hasJoint`。**删前确认 clip/stencil 8 个不是给外部 embedder 的公开 API。**

**Python / Node / CMake 死项**：`type_system.py` 的 `needs_wrapper` 被同名第二定义**整个遮蔽**（第一个永不执行）+ `is_glm/is_custom_struct` 零调用；Node 死导出（`buildAllWasm`/`buildSdkDirect`/`syncWasmOnly`/logger spinner 全套/`hash.js` 部分/`errorHelp BuildError`）；`Emscripten.cmake:149` `es_apply_emscripten_settings()` 死簇（导出的 `_es_app_init` 无定义，pre-SDK 遗留）；孤儿且**损坏**的 `tools/bundle-playable.js`（CommonJS require 但 root 是 ESM，一跑就崩）；`tools/pack_bitmap_font.py` 零 wiring。

**整目录决策项**：`src/esengine/events/` 仅被 `tests/events/test_events.cpp` 消费，引擎/SDK/示例零集成（含纯死的 `ScopedConnection`、`Signal` 非 void 特化 ~115 行）。**若不打算发布事件系统，整目录是删除候选。**

### B2：功能静默缺失（必须**接线或明确移除**——需产品决策）

| # | 位置 | 现象 | 影响 |
|---|---|---|---|
| **B2-1** | `tilemap/tiledLoader.ts` `generateTileCollision:544` / `collisionMerge.ts` | 只被测试调用；生产路径 `parseTmjJson→tilemapPlugin` 上传 tile 但**不生成任何 collider** | **活的瓦片地图静默无碰撞**（正确性） |
| **B2-2** | `ui/plugin.ts:25` `uiBehaviorPlugin` | barrel 导出但不在 `uiPlugins.ts` 的 11 插件中 → 任何 `createWebApp` 应用里**整个 Layer-2 UI 行为层（ListView/StateMachine/滚轮）永不 tick** | 整层功能死 |
| **B2-3** | `platform/wechat/WeChatAudioBackend.ts:95` | `mixer` 返回 null（Web 返真 AudioMixer） | 微信平台 `setMusicVolume/SFXVolume/UIVolume/master` **静默 no-op** |
| **B2-4** | C++ MaterialCache 链 | `getMaterialDataWithUniforms` 零调用 = 唯一写 `material_cache` 者 → `EngineState::material_cache` 永空 | TS 侧 `invalidateMaterialCache/clearMaterialCache`（`material.ts:200-281`）沦为**对永空 map 的 no-op** |
| **B2-5** | `resource/ShaderParser` `remapCompilerLog`/`assembleStageEx` | 完整的错误行号重映射功能从未接入编译错误路径（活的 `assembleStage` 丢弃 `headerLineCount`） | shader 报错行号不准（最高价值"待接线"项） |
| **B2-6** | `PostProcess volumeSystem.ts:91` | 只激活 `isGlobal` 体积（硬编码 factor:1），非全局体积取出即丢 | 空间体积混合运行时全死 |
| **B2-7** | Timeline `MarkerTrack` / `CustomEventTrack` | TimelineLoader 解析但 Uploader 无 upload case | "timeline 触发游戏事件"未完成，静默丢弃 |
| **B2-8** | `core/Log.hpp` sink 子系统 | `addSink/removeSink` 零调用，`sinks_` 恒空，`notifySinks()` 每条日志空转 | 日志无法重定向 |

其它半成品：Spine asset-loader controller 路径从未武装（`setSpineController` 无人调用，`getSkeletonHandle` 恒 -1）、`uiBehavior` 的 `uiFlexLayout_update` 空 stub、prefab diff 无法发 `entity_removed`、audio `priority`（voice-stealing 搭架未实现）。

### B3：配置 / 构建死项与不一致
- **`build.config.js:15-19` optimization 只覆盖 15 个 wasm 目标中的 3 个**，其余 12 个（含本应 `-Oz` 的 `physics-playable`）静默拿默认 `-O2`。**发布意外优化级别。**
- 优化级别**三处规定且互相冲突**：`build.config.js`（编译 -O2/-Oz）vs `Emscripten.cmake`（链接硬编码 -O3）vs `wasm.js:144`（wasm-opt）——无单一真源。
- `CMakeLists.txt:224` `GENERATED_EDITOR_API` 缺于 eht custom_command 的 OUTPUT/DEPENDS（潜在增量构建陈旧）；toolchain CLI `--no-strip/--no-archive`/`--debug` 被忽略/中和；`tasks/sdk.js` SDK 文件列表声明两次会漂移；`field_utils.py VEC*_SUBS` 与 `anim_target.py` 重复。

---

## C. 性能债（热路径低效）

### C-Critical：每帧整体重算，有现成 dirty 机制却被绕过
- **C1 UI 布局树每帧无条件全量重建** `ecs/UILayoutSystem.cpp:421` → `UITree.hpp:28`：`layoutUpdate` 每帧 `tree.rebuild()` 重走整棵 Canvas 层级，**而 `rebuildIfDirty()` + `structure_dirty_` 已存在、JS 导出已接好**（`WebSDKEntry.cpp:550`），紧随的 `unifiedLayoutPass` 本身已 dirty 门控、被白白浪费。修：改调 `rebuildIfDirty`（近一行）。风险中：先审所有 add/remove/reparent 是否都 mark dirty。
- **C2 `UITree::indexOf` O(n) 被 `markDirty` 沿祖先链反复调** `UITree.hpp:65`：单次 markDirty O(depth×n)，批量 mark 退化每帧 O(nodes²)。修：rebuild 时建 `Entity→index` 表，O(1)。
- **C3 UI render-order 每帧全量 DFS 重算** `UIRenderOrderSystem.hpp:38`：无 dirty 门控，结构不变也算同样的值。修：复用 C1 的 structure-dirty 信号。

### C-High
- **C4 DrawList 每帧整表深拷贝排序缓冲** `DrawList.cpp:35-40`：每帧堆分配全量 `std::vector<DrawCommand>`（~96B/条 ×数千）+ 乱序深拷贝每条 + 释放旧。`sort_entries_` 间接排序本为避免物化，这里又物化了。修：`sorted` 提升为常驻 scratch 或就地按序合并。
- **C5 每帧字符串查 uniform location** `DrawList.cpp:70`：draw 循环里 `getUniformLocation(shader, "u_projection")` 字符串键查找 + 跨界，且 `u_projection` 整帧恒定却每次 shader 切换重 set；`Shader::uniformCache_` 被绕过。修：每 program 缓存 location，每帧 set 一次。
- **C6 粒子 `forEachAlive` 扫满池容量 + `std::function` 间接调用** `particle/Particle.cpp:55`：容量 10000/存活 50 仍跑 10000 次。修：packed swap-remove 迭代 `[0,alive)` + 模板函子。风险中（现用索引算术，需协同改）。
- **C7 SpineController 每帧每批拷贝两个 typed array + 对象字面量** `spine/SpineController.ts:224-271`：`new Float32Array(vertices)` + `new Uint16Array(indices)` 每实例每批每帧 → 动画 Spine 主 GC 源。修：池化 scratch / 直接暴露 heap view 上传。
- **C8 BuiltinBridge 冗余 JS `Set<Entity>` 镜像** `ecs/BuiltinBridge.ts:303`：每内置组件成员关系在 C++ 和 JS Set 各一份；`deleteFromEntitySets` 每次 despawn O(组件类型数) 全扫。**约束：query 规划器的 smallest-set 收窄依赖它的 `.size`，不能直接删**。修：让 delete 只动该实体实际所在的 set。

### C-Medium / 快速 win（一行 / 低风险类）
- **M2 `packColor` 在 4 顶点循环内重复算** `SpritePlugin.cpp:138`、`UIElementPlugin.cpp:140`：提到循环外，**一行、零风险**（nine-slice/text 路径已正确提外，基础四边形漏了）。
- 文本 collect 每帧走 3 遍字符串 + 逐字符 hash（`TextPlugin.cpp:71,90,121`，`measureText` 已返回宽度可复用）；`TimelineRuntime.ts:185` per-property 循环内 `.filter` O(n²) + 每帧数组；`PhysicsSystem.ts:410` 每帧 4 数组 + 每事件字面量 + 空资源对象；UI behavior 模板字符串键 slot 查找 + 每帧 Color/scale 字面量；`world.ts` 多处（空查询不缓存、每帧重建 depIds、`getComponentTypes` 线性扫 + `has()` 风暴）；`ChangeTracker` 连 `isEmpty` 都分配数组；`L2 RenderFrameSubmit.cpp:86` Spine 索引重映射每批堆分配。

> 已核实为**干净**（无需动）：`TransformSystem`（正确 dirty 跳过干净子树）、`StateTracker`（模范去重 early-return）、`TransientBufferPool`（缓冲复用非每帧重建）、`QueryCache` hit 路径零分配、`ptrAccessors`（写预分配 out + 每实体重读 HEAP 是 `ALLOW_MEMORY_GROWTH` 下的**必要**正确性）。

---

## D. 结构债（设计层，大重构）

### D-High
- **D1 entity/handle 位打包逻辑三处独立复制**：`core/Types.hpp:128`（Entity 20+12 位）、`resource/Handle.hpp:52`（逐字复制）、`ecs/Entity.hpp:5`（FFI 64-bit 第三套）。扩世界容量要三处同步改，漏改即句柄碰撞。修：抽 `PackedId<INDEX_BITS,GEN_BITS>` 模板委托。**非 TypeId 排除项**（那是类型身份，这是实例索引+代际）。
- **D2 `ResourceManager` 五类资源样板各一套 + Texture 独挂 GUID 层** `resource/ResourceManager.hpp:131-357`：违反 SRP，四套独立 pool 的 find/add/release 重复，Texture 释放耦合元数据/GUID。修：`TypedResourcePool<T>` 模板 + `TextureMetadataRegistry` 下沉。**RC6 资产管线会建在其上，先收口收益大。**
- **D3 `world.ts` 770 行 god class + 组件操作双路由**：实体生命周期 + 层级 + builtin/script 路由 + 查询缓存全塞一类，`isBuiltinComponent` 分支在 insert/set/get/has/remove/tryGet 出现 14+ 次。修：拆 `EntityManager`/`HierarchyManager`/`ComponentDispatcher`/`QueryEngine`。
- **D4 SceneManager / App 两套实体销毁路径** `sceneManager.ts:356` vs `app.ts:539`：销毁/卸载决策分散两处，SceneManager 本应只管配置却直接操纵 world。修：抽 `SceneOrchestrator` 统一实体生命周期。
- **D5 UI 三 plugin 各自重造 Entity→资源缓存 + 清理循环** `TextPlugin.ts:31`、`ImagePlugin.ts:22`、`TextInputPlugin.ts:49`：同模式三份，驱逐策略不一致；`TextRenderer.ts:47` 文本缓存无上界（长时游戏 OOM）。修：抽 `EntityResourceCache<T>`（acquire/release + valid 驱逐 + LRU 上界）。

### D-Medium（择要）
- 四边形索引绕序两套不一致（4 plugin `{0,1,2,2,3,0}` vs ParticlePlugin `{0,1,2,0,2,3}`）+ QUAD 常量 5 处复制 → 抽 `QuadPrimitive.hpp`。
- Registry 手搓重入守卫（`firing_destroy_` + dead 标志）与 `events/Signal.hpp` 成熟的 `publishing_` + RAII Connection 重复 → Registry 复用 Signal。
- WASM `_malloc`/HEAP 视图/`ptr>>2` 散在 draw/geometry/material 各自管理 + `PTR_LAYOUTS` 误入公共导出 → 抽 `WasmScratch`，内部化布局。
- `RenderFrame` 编排过载（10+ 不相干成员，clip 与 ClipState 双层维护，stencil 内部结构体泄漏进接口）；`BuiltinBridge` 五职责混杂；`UISystem` 公有可变成员破坏封装；C++ 缺字符串工具层（trim 双实现）。

---

## 执行优先级（建议分档，全程保持构建常绿、每项独立验证）

| 档 | 内容 | 理由 |
|---|---|---|
| **1. 堵裂缝（先做）** | A1/A2/A5（单点消除确定 abort/OOB）→ A6/A7/A8/A9（ECS 核心 OOB/UAF/下溢，`ES_ASSERT` strip 暴露面最广）→ A3/A4/A11/A12（Spine/Particle UAF）→ A16/A17/A18（TS 挂死/泄漏/场景 wedge） | 真 bug，独立、多为小改动，**每项先写回归测试**。建议同时做"边界检查 release 生效"的系统性修复 |
| **2. 删死代码（低风险）** | B1：platform/ 死岛、resource/ 死面整块删；6 死 shader、Engine、Script.hpp、~28 死绑定、Python/Node 死项 | 缩小地基面积，让后续重构更清晰，零行为变化 |
| **3. 决策半成品（需拍板）** | B2：Tilemap 碰撞、UI 行为层、微信 audio mixer、MaterialCache 链、ShaderParser 报错重映射——逐个"接线 or 移除" | 功能静默缺失，**产品决策**：要这功能就接线，不要就删（别留半成品） |
| **4. 性能快速 win** | C1（一行 rebuildIfDirty）、M2（一行 packColor）、C5（缓存 uniform location）、C2/C4 → C6/C7 | 低风险、改动局部、收益直接；"有机制没用上"类 |
| **5. 大重构立项** | D1（位打包统一，RC6 前）、D2（ResourceManager 模板化，RC6 前）→ D3/D4（World/Scene 拆分）→ D5（UI 缓存） | 影响演进，工作量大，作为新 RC 排期 |

---

## 验证机制
- **A 类**：每个缺陷**先写复现/回归测试**（触发条件 → 期望不崩/不泄漏），红→绿后再清单标记修复。优先用 header-only / MockGfxDevice harness（RC1–RC6 已验证可本机原生编译验证）覆盖 ECS/资源/渲染内部。
- **B1 删除**：删后全量构建 + 全测试套件常绿（零行为变化即证明确为死代码）；embind 删除额外 grep `wasm.ts` 确认无声明残留。
- **B2 接线**：接线项补"功能确实运行"的集成测试（活地图有 collider、UI 行为层 tick、微信 audio mixer 真改音量）。
- **C 类**：性能项配 before/after 计数断言（draw call 数、每帧分配数、迭代次数），避免回归。
- **D 类**：大重构每批保持外部行为不变，用既有测试套件 + 新增结构测试守门。

---

## 实现进度（living status）
- 📋 全部已立项，未开始执行。
- 建议首批：A1/A2/A5（确定 abort/OOB，最小改动最高确定性）+ B1 的 platform/resource 死岛删除（低风险、立即缩小面积）。
