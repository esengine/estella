# Estella Spine 子系统重构 —— 单实现 · 全 side-module · 真多版本(REARCH_SPINE)

> 目标读者:引擎维护者 / AI 协作代理。
> 体例同 `REARCH_EDITOR_REALM.md` / `REARCH_ENGINE_INSTANCING.md`:描述**目标架构**与根治路径,而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`(2026-06 四路并行只读审计 + 交叉印证)。
> **立项缘由**:Spine 当前是**双运行时**架构,而这套复杂度是"一个**真需求(运行时多版本)** 被**半成品 + 重复**地实现了"。真需求确凿——很多用户**只有 3.8 的导出产物、没有 `.spine` 源文件**,导入期转换走不通,运行时必须能跑多版本。但当前实现是**最贵的那种**:一个版本(4.2)进引擎、其余流放 side-module、整条流水线手抄两遍。**本文把它收口成:所有版本对称的 side-module + 单一实现。**
> **执行纪律(用户明确):终态删掉原生重复,不为兼容保留旧路径**;分阶段只为每步可验证。

---

## 0. 核心诊断

**真正的分界线不是"C++ vs JS",是"引擎链接单元 vs side-module"。** 一个 wasm 只能静态链接**一份** spine-cpp(不同大版本符号/ABI 冲突)。4.2 拿到"引擎内"特权位**纯属偶然**(谁是当前版本谁就进引擎);所谓"JS 路径"里**没有一行动画跑在 JS**——那 ~1000 行 TS(`SpineManager`/`ModuleBackend`/`SpineController`/`SpineModuleLoader`)全是为了从 JS 调用 sibling wasm 模块的胶水。

**三条事实定调:**
1. **多版本是真需求**(用户只有旧版导出产物),不能删。
2. **side-module 全平台可加载**(已验证):web 用 `blob`+`import()`、微信用 `WXWebAssembly.instantiate(path)`(`platform/wechat/wasm.ts`,需基础库 ≥2.13)、playable 内联;`wechatRuntime.ts:189` 已在按版本加载 `spine_${tag}.wasm`。**平台不否决全 side-module。**
3. 把 4.2 移出核心 → **不用 spine 的游戏核心更小**(spine-cpp ~278KB 不再人人付),用 spine 的按需加载,和 physics 现状一致(pay-for-use)。

**结论:全 side-module + 单实现是最优。** 没有任何一条站得住"4.2 必须留引擎内"——spine-c 4.2 与 spine-cpp 4.2 功能对等;跨堆 memcpy 已零分配、微秒级可忽略;平台已封装。

---

## 1. 现状病灶(file:line)

### G1:整条流水线被实现两遍(根因)
- **side-module 路径**:`bindings/SpineModuleEntry.cpp`(~1080 行,`#ifdef ES_SPINE_38/41` 按版本分叉),自带 skeleton/atlas/animation/mesh 提取/event/IK/constraint 一整套,用 **spine-c**(纯 C)。
- **原生路径**:`spine/SpineSystem.cpp`(380)+ `renderer/plugins/SpinePlugin.cpp`(290,collect/emitRegion/emitMesh)+ `spine/SpineResourceManager.cpp`(200),用 **spine-cpp**(C++)。
- 二者**不共享代码/类型/所有权规则,连 spine 运行时风味都不同**。网格提取各 ~180 行近乎雷同。加一个 spine 功能要改 ~5 处(raw 声明、wrapped API、`wrapSpineModule`、controller、backend、manager)。

### G2:多版本是半成品,从没接通
- 构建声明了 `spine42`/`spine41`/`spine38` 三个 side-module 目标(`CMakeLists.txt:446-503`,同一 `SpineModuleEntry.cpp` 对不同 spine-c 源),但**磁盘上只有 `spine42.*`**——`spine38.*`/`spine41.*` 全仓不存在。
- **web 侧 `SpineWasmProvider` 没有任何具体实现**(`SpineModuleLoader.ts` 只声明接口;`webAppFactory.ts:38` 是可选注入点,无人注入)→ 这就是"3.8 用户跑不起来"的直接原因。微信侧 `wechatRuntime.ts:189` 半接通。

### G3:两条路渲染不一致(潜在正确性 bug)
- 原生 `SpinePlugin.cpp:179-202` 有真 `SkeletonClipping clipper_`;side-module `SpineModuleEntry.cpp:556` **静默跳过 clipping attachment**。**用同一资产两条路渲染结果不同**——重复直接孕育的 bug。

### G4:资源所有权(真正还 OPEN 的 bug)
- **共享 skeletonData 的 UAF**:`SpineResourceManager.cpp:99-102` `load()` 命中缓存**不 `addRef`**,而 `SpineSystem.cpp:134-145` `reloadAssets` 按实体逐个 `release` → 第一个 release 就把多个实体共享的 `SpineSkeletonData` 释放,其余实体的 `::spine::Skeleton` 仍指向已释放的 `skeletonData`(`SpineSystem.cpp:69`)。
- **纹理 refcount 泄漏/释放不对称**:`SpineResourceManager.cpp:43` 把 page key 编码成去重后的 `handle.id()+1`;多页/共享页图集下,`loadTexture` 按路径去重使两页拿到同一 handle/key → `texture_handles_` 只剩一条、refcount 加了两次,`unload` 只释放一次 → 泄漏。
- 现成的 RAII `SharedHandle`(`resource/Handle.hpp:132-175`)**已存在但 Spine 没用**。
- side-module 的 `g_ctx`(`SpineModuleEntry.cpp:149`)是**全局裸 map、零 RAII**,正确性全靠每条错误路径手动 dispose。

### G5:三层透传塔 + spine 内部细节泄漏进 TS
- `SpineManager`(363)→`ModuleBackend`(238)→`SpineController`(417),每层只重新解析 handle 再转发,~20 个方法逐层重复。
- TS 知道它不该知道的 spine 内部:二进制 varint 版本头解析(`SpineManager.ts:326-362`)、顶点 stride `*8*4` / 索引 `*2`(`SpineController.ts:252`)、事件 stride=4 与 `typeNum===5`(`SpineController.ts:325` 与 `SpinePlugin.ts:173` 重复)。版本串 `'3.8'|'4.1'|'4.2'` 在三个文件重声明。
- **潜在双提交**:`SpinePlugin.ts` `setSpineManager`(61-70)与 `build`(124-130)各注册一次 `submitMeshes` preFlush,拷贝粘贴雷同。

### G6:side-module 路径的跨堆拷贝(已零分配,保留为统一成本)
- spine 堆 → core 堆 的 `HEAPU8.set`(`ModuleBackend.ts:205-216`),已是零分配 scratch arena。原生 4.2 直写 transient buffer 无此拷贝。统一后 4.2 也付此拷贝——**微秒级,可接受**。

---

## 2. 目标架构(A:单实现 · 全 side-module)

1. **所有版本对称**:每个版本 = `spine{NN}.wasm` side-module,全部由**同一份** `SpineModuleEntry.cpp` 对不同 spine-c 源编译。引擎核心**零原生 spine**(spine-cpp 移出链接)。
2. **单 `SpineRuntime` 接口**(TS):`load(skeleton,atlas)→instance`、`update(dt)`、`produceMeshBatches()`、`collectEvents()`、constraint/IK/slot 等;**一个实现**(side-module 后端)。`SpineManager` 只管 实体→版本→backend 路由 + 网格/事件 fan-out。**删 `SpineCpp` dual path 与所有 fallback**。
3. **删原生路径**:`SpineSystem.cpp`、`renderer/plugins/SpinePlugin.cpp`、`SpineResourceManager.cpp`、`spine_*`/`spine_native_*` embind(`WebSDKEntry.cpp`/`RendererBindings.cpp`)、`needsReload`/`spine_setNeedsReload` 握手、双 tick。
4. **把统一路径提质到原生水平**:把 `SpinePlugin.cpp` 的 clipping 移植进 `SpineModuleEntry.cpp`;保留零分配 scratch 提交;网格/事件做到与原生 4.2 逐像素 parity。
5. **资源所有权根治**:`SpineModuleEntry.cpp` 的 `g_ctx` 改 RAII(move-only `Skeleton`/`Instance` 类型,析构即 dispose,`reset()`=`.clear()`);骨架数据按"路径+scale"做真正的 dedup + refcount(命中即 addRef);纹理按 `AtlasPage*` 而非去重 handle 做 key。
6. **TS 收口**:三层塔压成两角色(thin per-runtime `SpineBackend` + 一个 `SpineManager`);把 varint 版本嗅探、顶点/事件 stride、事件码推回 wasm 边界(`spine_detectVersion`/`spine_describeVertexFormat` 导出),TS 只碰不透明 handle + 字节数。修双提交。

---

## 3. 需要拍板的岔路(已定)

| 岔路 | 选项 | 决定 |
|---|---|---|
| 多版本怎么给 | 格式转换器(3.8→4.2) / 各版本官方 spine-c side-module | **side-module**:转换器脆弱、非官方、易错;官方运行时稳 |
| 4.2 放哪 | 留引擎内(零拷贝,但强制双实现) / 全 side-module | **全 side-module**:单实现 + pay-for-use,跨堆拷贝可忽略 |
| 版本选择时机 | 构建期单版本 / 运行时多版本 | **运行时**:真需求(用户混装不同版本资产,且无源不能重导) |
| 终态是否保留原生 4.2 | 保留作快路径 / 删除 | **删除**(用户明确:不为兼容失去最优架构) |

---

## 4. 迁移序(分阶段,每段可验证;**终态删原生,不留兼容残桩**)

### S1 —— 先接通多版本(解用户痛点,低风险,不碰 4.2 原生)
实现 web `SpineWasmProvider`(对照 `wechatRuntime` 的微信版)+ 实际构建/出货 `spine38`/`spine41` side-module + `webAppFactory` 默认注入 provider + `SpineManager` 真正加载。**验证:一个真实 3.8 资产能加载 + 动画 + 事件**(web 与微信各一)。此阶段 4.2 暂留原生——仅过渡。

### S2 —— `SpineModuleEntry` 提质到原生水平
把 `SpinePlugin.cpp` 的 `SkeletonClipping` 移植进 `SpineModuleEntry.cpp`;统一网格/事件提取。**验证:side-module 4.2 与原生 4.2 关键帧逐像素一致**(parity 对拍);clipping 资产两条路渲染相同。

### S3 —— 4.2 切到 side-module + **删原生**
`spine42` 成 canonical 运行时;`SpineManager` 所有版本走同一 backend 接口;**删** `SpineSystem.cpp`/原生 `SpinePlugin.cpp`/`SpineResourceManager.cpp`/`SpineCpp` embind/`needsReload`,**spine-cpp 移出核心链接**。**验证:全量 `node build-tools/cli.js build -t web` + 微信 + playable 三平台跑通;核心 wasm 体积下降 ~278KB;不用 spine 的 example 不再含 spine 代码。**

### S4 —— 资源所有权 RAII 根治
`g_ctx` move-only RAII + 骨架数据 dedup/refcount(命中 addRef)+ 纹理按 page key。**验证:ASAN 下多实体共享同一骨架 reload/despawn 无 UAF;多页图集 load/unload refcount 对称。**

### S5(收尾)—— TS 层收口
三层塔压两角色;spine 内部细节(varint/stride/事件码)推回 wasm 导出;修双提交;删冗余类型面。**验证:desktop/sdk 套件常绿;加一个 spine 集成测试。**

> 删 `third_party/spine-runtimes-3.8|4.1` 的**未用第三方源树**(~290MB)作为独立清理项,在对应版本 side-module 改用精简后或 S3 后进行。

---

## 5. 验证机制(机制即根治成立的证明)
- **渲染 parity(最关键)**:原生 4.2 与 side-module 4.2 同场景**关键帧逐像素对拍**(S2 门槛);clipping 资产两路一致。
- **多版本**:3.8 / 4.1 / 4.2 各一个真实资产能加载 + 播放 + 触发事件。
- **三平台**:web(blob)/ 微信(WXWebAssembly)/ playable(内联)各跑通同一 spine 资产。
- **体积**:核心 `esengine.wasm` 减小 ~278KB;不含 spine 的 example 产物不再含 spine 代码(metafile/符号断言)。
- **所有权**:ASAN——多实体共享骨架 + reload/despawn 交错;多页/共享页图集 load/unload 对称。
- **回归**:SDK 全量 + desktop vitest + 全量 wasm 构建常绿。

---

## 6. 与其他条目的关系 / 既定取舍
- **吃掉重复**:S3 后只剩 `SpineModuleEntry.cpp` 一套实现;G1/G3(渲染分歧)随之消失。
- **接 RAII 连接**:与刚落地的 `Registry::onDestroyScoped`(RAII 订阅)同精神——所有权由 RAII 强制,不靠手动。
- **接 pay-for-use**:spine-cpp 移出核心,呼应 wasm-split / 按需加载方向。
- **零 ABI 影响**:不改组件布局/哈希;`SpineAnimation` 组件字段不变(仍 `skeletonPath`/`atlasPath`/...,无 version 字段——版本运行时嗅探)。
