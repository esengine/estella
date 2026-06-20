# Estella 无损序列化 / 数据模型（Lossless Serialization）

> 目标读者：引擎维护者 / 编辑器作者 / AI 协作代理。
> 体例同 `REARCHITECTURE.md` / `REARCH_ENGINE_INSTANCING.md`：描述目标架构与根治路径，而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`（2026-06 两路并行只读审计 + 交叉印证）。
> **立项缘由**：这是 `RC12_EDITOR_SEAM.md` 最优编辑器架构的**第二条腿**（第一条是 `REARCH_ENGINE_INSTANCING.md`）。当前"无损保存"做不到——编辑器用 `lossy` 标志**拒绝覆盖保存**（`desktop/src/project/ProjectStore.ts:278`），这是症状；根因是序列化结构性有损。它也是 play==ship、prefab、play 快照的共同地基。

---

## 0. 核心诊断：live world 是 SceneData 的有损投影

往返链：`load (JSON→world) → 编辑 world → save (world→JSON)`。根因是 **world 装不下 SceneData 的全部信息**，于是"从 world 读回"永远吐不全：

1. **load 丢信息**：未知组件直接丢弃；已知组件的未知字段被过滤；`visible:false` 实体根本不 spawn。
2. **world 降精度**：builtin 数值字段以 **f32** 存（指针布局），double 写入即截断。
3. **save 只能吐 world 里剩下的**：且 asset 字段输出**裸 handle 数字**而非 `@uuid:`（`serializeScene` 无反向映射）。
4. **编辑器症状**：`lossy` 标志 + 拒绝覆盖保存；且连 Save-As 也救不了未知组件——它们在 load 投影时就从 world 消失。

> **命门**：只要"保存从 world 读回"，无损就需要无穷多 passthrough/反向补丁去对抗信息丢失，且**未知组件里的 entity 引用无法被 SDK 重映射**（SDK 不认识其 entityFields）。**两路审计独立同结论：JSON-first 让真相从不进入 world，无损是免费的、结构性的**——这正是"结构强制 > 约定"在序列化上的落地。

---

## 1. 病灶（file:line）

### S1：未知组件被丢弃，且 world 之后再也拿不回
- load：`loadComponent` 里 `getComponent(type)` 未注册 → `warn + return`，组件**完全丢弃**（`sdk/src/scene.ts:396-400`）。
- serialize：world 根本不持有未知组件；`getComponentTypes` 只枚举已注册（`world.ts:562-590`），`getComponent` 再过滤一次（`scene.ts:485-486`）。
- 编辑器：`unknownComponentTypes(raw)` 在 **原始 JSON** 上检测并设 `lossy`（`ProjectStore.ts:44,166,177`），但检测完 `resetWorldTo` 即丢（`:176`）；`save()` 用 lossy 拒绝覆盖（`:278`），Save-As 无守卫（`:289`）却同样丢——**lossy 标志只能阻止保存，救不回数据**。

### S2：已知组件的未知字段被过滤
- builtin insert：`if (!(k in defaults)) continue`（`sdk/src/ecs/BuiltinBridge.ts:524-526`）。
- builtin set：`world.set` 同样删未知键（`sdk/src/world.ts:356-361`）。
- script：`component.create` flat 分支 `{...defaults, ...data}` **意外保留**顶层未知 scalar，但嵌套/keyInfo 分支不保留（`sdk/src/component.ts:101-121`）——**不一致**。

### S3：builtin 数值 f32 截断
- 指针快路 `readPtrField`/`fillPtrField` 读写 `f32[idx]`（`BuiltinBridge.ts:105,142,545,565`）；double 写入被截断。script 组件全 JS 对象、double 保真。往返多次收敛（首次截断后不再漂移），但与原始 double 源值有一次性偏差。

### S4：`visible:false` 实体 load→save 后永久消失
- load：`visible===false` 整 entity **不 spawn**（`scene.ts:295,303`）→ world 里不存在。
- serialize：`serializeScene` **从不输出 `visible` 字段**（`scene.ts:499-512`）→ 所有保存的 entity 默认 visible=true。

### S5：asset 引用往返 lossy，且靠编辑器私有补丁
- 盘上格式 `@uuid:`（`sdk/src/asset/AssetRegistry.ts:19`）。load 把 `@uuid:`→ 运行时 handle **原地改写** `comp.data[field]`（`sdk/src/asset/Assets.ts:478,487,504,509`），**不留反向映射**。
- `serializeScene` 输出**裸 handle 数字**（`scene.ts:487`）；SDK **无 handle→uuid 反向**（全仓 grep 确认）。
- 还原靠编辑器私有 `restoreAssetRefs` + `handleToUuid` map（`ProjectStore.ts:241-255,224`），且**只覆盖 texture**——material/font/audio 即便是 handle 也写出裸数字（无意义的运行时值）。`枚举`层 `getComponentAssetFields` 覆盖全类型（`scene.ts:101`），但 map 只被 texture 填充。

### S6：textureMetadata（九宫格 sliceBorder）不输出
- load 应用到 ResourceManager（`scene.ts:380-390`），serialize 输出对象**没有 textureMetadata 字段**（`scene.ts:508-512`）。

### S7：编辑器真相 = live world（确认链）
- 编辑写 world：`SceneCommands` 全走 `mutableWorld()` + `world.set/insert/spawn/despawn`（`SceneCommands.ts:86,168,207,225,263`），无 JSON 写。
- 保存从 world 读回：`serializeCurrent` → `serializeScene(world)`（`ProjectStore.ts:234,237`）。
- load 单向投影：`loadCurrentScene` → `resetWorldTo(world,data)`（`:176`），原始 JSON 投影后丢弃。
- inspector 也读 world（`SceneQuery.ts:33,77,89`）；`InspectorFieldType` 无 asset 类型（`types.ts`）——asset 字段当前只读穿透。

### 影响面（serializeScene/resetWorldTo 消费方）
- `serializeScene`：EngineHost play 快照（`EngineHost.ts:151`，纯内存往返、最隐蔽地丢东西）、编辑器保存（`ProjectStore.ts:237`）、SDK re-export（`core-content.ts:74`）。
- `resetWorldTo`：play Stop 恢复（`EngineHost.ts:154`）、编辑器 load（`ProjectStore.ts:176`）。
- prefab 实例化复用 scene load 下游（`prefab.ts:101`）→ **同病**；但 prefab 已有 `PrefabEntityData.metadata` 无损通道（`prefab/types.ts:38`）可作范式。

---

## 2. 目标架构：JSON-first 数据模型（编辑器真相 = SceneData，world = 渲染预览）

1. **SceneData JSON 是编辑器唯一真相**。load 后**保留**这份数据模型（不再投影即弃）。未知组件、未知字段、material/font/audio 的 `@uuid:`、任意扩展字段——全部原样留在数据模型里，**从不经过 world**，故从不丢失。
2. **world 降级为只读渲染预览**：从数据模型**投影**而来；编辑不直接改 world 当真相。
3. **编辑经命令改数据模型**（承接 E2 的命令边界）：`SceneCommands` 的每个写操作改的是数据模型，再**增量同步**到 world 预览（见岔路）。inspector / `SceneQuery` 读数据模型（更简单——直接读 data，不用 `world.get`）。
4. **保存 = 序列化数据模型**（`JSON.stringify` 级别）：**无损是免费的**。`lossy` 标志、passthrough、`restoreAssetRefs` 私补**全部消失**。
5. **play 快照取数据模型**（而非 `serializeScene(world)`）：play/stop 无损 + 对齐 play==ship。
6. **稳定的 editor entity id**：数据模型自持稳定 id（不依赖 world spawn 顺序);投影时建 `jsonId → 预览 runtime entity` 映射（复用 `remapEntityFields` 的 id→id 机制，`scene.ts:131`,方向反转）。
7. **引擎侧（次要 / 防御）**：把 handle→`@uuid:` 反向映射下沉 SDK（`Assets` 在 `resolveSceneAssetPaths` 处已同时握有 ref+handle，只是写完就扔——`Assets.ts:487`），让任何 world→JSON 导出也可移植;并可选地给引擎加未知组件 passthrough 作非编辑器消费者的防御纵深。JSON-first 下编辑器**不依赖**这些,但它们让 `serializeScene` 本身不再有损。

---

## 3. 需要拍板的岔路

| 岔路 | 选项 | 推荐 |
|---|---|---|
| **真相模型** | JSON-first（真相=JSON，world=预览） / world-round-trip + passthrough（真相=world，未知物塞 sidecar） | **JSON-first**：无损 by construction;passthrough 路是与信息丢失打的无尽补丁战(sidecar↔entity 对位脆、未知组件的 entity 引用无法重映射、asset 反向仍要补)，且 lossy 是约定非结构 |
| **JSON→world 预览同步** | (a) 单一真相 + 增量投影(差分 patch world) / (b) 双写(命令同时改 JSON + world) | **(a) 增量投影**为目标(单真相、无双态分歧风险);**(b) 双写可作过渡**(复用 E2 命令、落地快),但有 JSON/world 分歧风险，需收敛到 (a) |
| **asset 反向映射** | 下沉 SDK(serializeScene 直出 @uuid:) / 维持编辑器私补 | **下沉 SDK**:`Assets` load 时建 `handle→ref` 反向 map，serialize 经注入回调换 ref;删 `restoreAssetRefs`。注意 handle 复用需在 release 处清 map |
| **builtin f32 精度** | 接受 + 文档化(编辑器按 f32 显示) / 关键字段改 double | **接受 + 文档化**:JSON-first 下数据模型存 double 原值，world 只是 f32 预览;保存写数据模型的 double，故**保存值无 f32 损失**(只有预览是 f32) —— 这是 JSON-first 顺带白赚的精度修复 |
| **与 E2 的关系** | —— | E2 的"单一写门 + 自动 undo"命令边界**整体保留**;JSON-first 只是把命令的 `apply` 目标从 world 换成数据模型(+预览投影)。E2 不白做 |

### 一处要认的代价
JSON-first 是**编辑器核心的较大改造**:`SceneCommands`(~13 个写方法 + undo 闭包)改道到数据模型、`SceneQuery`/inspector 改读数据模型、新增"JSON→world 增量投影"层、稳定 id 分配器。但每一处都更简单(纯数据操作),且换来**无损这一结构性属性 + play==ship + 精度修复**,是一次性可控工程量,而非长期补丁债。

---

## 4. 迁移序（可拆、每步可验证）

- **L0（引擎侧，独立可先做，低风险）**:asset 反向映射下沉 SDK(`Assets` 建 `handle→ref`,`serializeScene` 加 `refResolver` 注入)。即便不上 JSON-first,也立刻让 `serializeScene` 不再丢 material/font 的 uuid;编辑器删 `restoreAssetRefs` 私补。验证:含 texture/material/font 引用的场景 world→JSON 往返,asset 字段为 `@uuid:` 而非裸数字。
- **L1（数据模型持有,已做）**:`SceneModel` 在 load 后保留完整 SceneData 为真相(未知组件/字段/visible/`@uuid:`)+ 模型⇄运行时 id 映射(取自 `resetWorldTo` 的返回 map)。`ProjectStore.loadCurrentScene` adopt。
- **~~L2（独立增量投影层）~~ → 被双写吸收**:没有单独的投影层;改为 **L3 的命令双写**(命令在改 world 的同时改模型)。world 仍是预览,模型仍是单一保存真相;省掉一个组件,代价是命令需维护两侧(由测试钉住一致性)。后续若要"模型为唯一真相、world 纯派生"再上独立投影。
- **L3（命令双写,已做）**:`SceneCommands` 的写原语(`applyFieldWrite`)与生命周期命令(add/delete/duplicate/rename)在改 world 的同时改 `SceneModel`(字段按 runtime,生命周期按稳定 source id 跟随 undo/redo recreate)。承接 E2 边界,undo/redo 闭包经同一原语自动同步。
- **L4（无损保存,已做)**:`ProjectStore.serializeCurrent` = `SceneModel.serialize()`(深拷贝模型,无损);`save` 删 lossy 拒绝逻辑;`serializeScene(world)` + `restoreAssetRefs` + 死的 `handleToUuid` 已移除。验证:golden——adopt 含未知组件场景 → 编辑/增删 → 序列化保留未知组件 + 反映编辑 + delete-undo 不丢未知组件。
- **L5（play 快照取数据模型,待做)**:`EngineHost.setRunMode` 快照数据模型而非 `serializeScene(world)`;Stop 恢复。接 play==ship。
- **（可选）L6**:引擎给非编辑器消费者加未知组件 passthrough(防御纵深);prefab 借 `metadata` 范式同样无损。

> **现状(L1+L3+L4 已落地)**:编辑器**已能无损保存**——开含未知组件的场景、编辑已知字段/增删实体、覆盖保存,未知组件/字段/`@uuid:` 原样保留。`lossy` 拒绝保存已退役。`engine-model-sync.test.ts` 钉住。剩 L5(play 快照)是 play==ship 的收尾。

---

## 5. 验证机制
- **golden 往返测试(核心,进 CI)**:`load(fixture) → save → deepEqual(原 fixture)`,fixture **必须含**:未知组件、已知组件的未知字段、`visible:false` 实体、texture+material+font `@uuid:` 引用、textureMetadata、需要 double 精度的字段。当前 `sdk/tests/scene.test.ts` **没有**这类字节级 golden(只有 migrate/codec/unknown-warn),是首要补的。
- **L0**:asset 往返断言(@uuid: 保真,全类型)。
- **L4**:`lossy` 标志删除后,含未知组件的场景可覆盖保存且无损。
- **回归**:SDK 全量 + editor build;E2 命令/undo 行为不变。

---

## 6. 与其他条目的关系
- **第二条腿**:与 `REARCH_ENGINE_INSTANCING.md` 并列,共同支撑 `RC12` 最优编辑器架构(隔离 realm + 无损 + play==ship)。
- **接 E2**:命令边界(单一写门 + 自动 undo)整体复用,只换 apply 目标。
- **解锁 play==ship**:L5 让 play 快照走数据模型,Stop 无损还原。
- **prefab 同病同药**:prefab 实例化共享 scene load 下游(`prefab.ts:101`),其 `metadata` 通道是 passthrough 范式。
- **零 ABI**:纯 SDK/编辑器 + 序列化格式版本化(`SCENE_FORMAT_VERSION` 机制已成熟,`scene.ts:186,208`),不动组件布局/哈希。
