# RC12：编辑器接缝现代化（Editor Seam Re-architecture）

> 目标读者：引擎维护者 / 编辑器作者 / AI 协作代理。
> 本文是 `REARCH_FRONTIER.md`（RC7–RC11）的**姊妹篇**，体例一致：描述目标架构与根治路径，而非现状。
> 现状审计见各小节"病灶"引用的 `file:line`（2026-06 只读审计，覆盖 `desktop/src/engine/*` 与 `sdk/src` 耦合面）。
>
> **立项缘由**：RC10（编辑器↔运行时协议）写于"**编辑器源码在仓外**"的假设下（见 `REARCH_FRONTIER.md` RC10 注）。该假设已失效——编辑器现作为 pnpm workspace 包 `@estella/editor` 落在 `desktop/`，通过 `workspace:*` 依赖 `esengine` SDK。接缝进仓后，RC10 的抽象债**具体化**为下列可直接动手的条目；其中 **E3/E5 是 RC10 的具体化**，**E6 是 RC9-1 的下游受害者**。本文不重复 RC7/RC8 的引擎内部现代化（渲染后端、并行、SIMD）——那些判断（"WebGPU 性感但不插队"）维持不变。

---

## 0. 核心诊断：一条接缝，两侧各自演化

编辑器与引擎现在同处一个 JS realm、同一个进程，靠**直接 mutate 共享单例 World + 观察者回调**接通。这在"单机本地编辑器"语境下是正确的起点——不该为了协议洁癖去上 `postMessage`/RPC。但接缝当前的形态有三个结构性弱点，会在"加载真实项目"这一步同时引爆：

1. **接缝两端的引擎产物各自漂移**：编辑器编译期链接 TS SDK、运行期加载 wasm，二者无构建期绑定（E1）。
2. **接缝没有强制的写边界**：World 是事实全局，写路径靠约定收口而非结构强制，可静默绕过 undo（E2）。
3. **接缝传递的信息过粗**：变更事件丢弃 payload，退化为"伪轮询"（E3）。

放大器：**编辑器 mutate 的是一个每帧仍在 tick 系统的活动 World**（无 edit/play 模式，E4）。今天没炸，仅因 `SceneLoader` 把项目用户系统全 SKIP 了——而那恰恰也是"无损保存"做不了的同一个根因（E6）。

> **亮点（不动）**：接缝的**分层切分本身是干净的**——`desktop/src/engine/` 已拆成 7 个聚焦模块（EngineHost 运行时 / SceneQuery 读 / SceneCommands 写 / ViewportController 拾取 / SceneStore 响应式 / EditorHistory 撤销 / schema 共享），依赖图无环。EngineHost 单 detached canvas 跨 dockview 重挂活下来、HMR self-reload 规避栈叠加 context（`EngineHost.ts:258-260`）也处理得当。本文的债集中在**模块之间那条线的契约**，不是模块划分。

---

## E1：两份引擎产物，无构建期版本/变体绑定

### 病灶
- **编辑器同时依赖引擎的两个独立产物**，二者只在"全量构建时恰好一起被拷贝"才一致：
  1. **TS SDK**：`esengine`（`desktop/package.json` `workspace:*`，含 `ptrLayouts.generated.ts` 固定偏移表 + `component.generated.ts` 的 `ABI_LAYOUT_HASH`）。
  2. **wasm 产物**：`desktop/public/wasm/esengine.{js,wasm}`，运行期由 `EngineHost.ts:122-134` 经 `${location.origin}/wasm/esengine.js` 动态 import 加载。
- **无变体记录 / 无构建溯源**：`build.config.js:158-160` 把 `build/wasm/{web,wechat,playable}` 都映射到 `desktop/public/wasm`。**更正**：三变体**文件名不同**（web=`esengine.js`、wechat=`esengine.wxgame.js`、playable=…），故**共存不覆盖**，编辑器固定加载 `esengine.js`=web——所以这里**不是覆盖歧义**（本文初稿的"谁后跑谁覆盖"判断有误）。真正缺的是：`public/wasm` 里没有任何"这是哪个变体、哪个 git sha、何时构建"的记录，stale 与否只能靠肉眼比对文件时间。
- **运行时握手是权威 fatal 检查，但晚且只覆盖 layout**：`createWebApp` 以 `{ strict: true }` connect bridge（`app.ts:854`），`BuiltinBridge.ts:341` 对 wasm 自报 `getAbiLayoutHash()` 与 SDK `ABI_LAYOUT_HASH` 不符**始终 fatal 抛错**（`:269`）——所以 **layout 漂移其实已被致命兜住**。但 (a) 只在**运行时、且 instantiate 之后**才触发，无 dev-server 期/实例化前的早检；(b) 只覆盖 **layout**——变体差异是 feature flag、不进 ABI hash，握手抓不到；(c) 依赖 wasm 带 `getAbiLayoutHash`，更老的二进制会静默跳过（`abiMismatch=null`）；(d) `ABI_LAYOUT_HASH` 当时**未从 `esengine` 导出**，宿主无法自己比对。
- dev 内循环：改 `sdk/src`（TS）→ vite 热更，但 `public/wasm` 仍是上次构建拷进来的旧二进制——靠运行时握手碰运气，且报错点深（embind connect 内部）而非接缝处。

### 目标架构（分层：引擎握手权威 fatal + 编辑器 manifest advisory）
1. **构建溯源 manifest（已实现）**：sync 时在 `public/wasm/` 旁挂 `wasm.manifest.json` `{schema, abiHash, editorTarget, variants, gitSha, builtAt}`。`abiHash` 取自刚生成的 SDK `component.generated.ts`（wasm 与该常量同由 EHT 管线一起生成，故忠实代表二进制的 `getAbiLayoutHash()`）。这补上"哪个变体/哪个 sha/何时"的记录。
2. **SDK 导出 `ABI_LAYOUT_HASH`（已实现）**：从 `esengine` 顶层导出，宿主/工具链得以自行比对（此前不可达）。
3. **编辑器 advisory guard（已实现）**：boot 前 fetch manifest，比对 `abiHash`/`editorTarget` 与 SDK 期望，**warn-on-drift / 缺失即 ok**——**刻意非 fatal**：手拷二进制会让 manifest 变陈旧，绝不能因陈旧元数据挡住本来能跑的 boot。权威 fatal 仍是引擎运行时握手（读真实二进制）。guard 把变体识别、构建溯源、早期漂移告警提前到实例化之前、且报在接缝处。
4. **（未做，可选）dev-server 期守卫**：vite 插件在 dev server 启动时比对 workspace SDK `ABI_LAYOUT_HASH` 与 manifest，红字 overlay，把告警从 boot 再提前到开服时。
5. **（未做，已重新评估为低优先）按变体分目录**：因三变体文件名本就不同、共存不覆盖，编辑器只取 `esengine.js`，分目录的收益远低于初稿设想；且目录搬迁会改运行时加载路径，需 launch-test，故暂缓。manifest 的 `editorTarget`/`variants` 已足够识别变体漂移。

> 这是 RC10"同步产物打协议版本戳"在编辑器侧的落地点。改动小、纯加法、堵的是最阴的静默漂移。

---

## E2：缺命令边界，World 是事实全局（可绕过抽象）

### 病灶
- **EngineHost 把 `app` 作为公开 getter 暴露**（`EngineHost.ts:46-48`），于是 `app.world` 对任何 `import { EngineHost }` 的模块都可达。写模块各自独立伸手取 World：`SceneCommands.ts:58/100/...`、`SceneQuery.ts:17/22/...`、`ViewportController`——**World 成了编辑器的事实全局**。
- **没有单一 command/transaction 入口**。撤销仅在调用方主动绕 `EditorHistory.record(...)` 时才登记（`SceneCommands.ts:118/137/158/178`）。任何代码直接 `world.set(...)`（裸写见 `SceneCommands.ts:96`）都会**静默跳过 undo**——而 `world.ts:371/379/455` 的 `notifyBridge('onComponentChanged')` 照常触发、响应式 UI 照常刷新，于是"漏记 undo"被完全掩盖，回归测试都不易抓。
- 这正是 RC 系列反复点名的"**可绕过的抽象**"根因家族在编辑器侧的复发：抽象（SceneCommands/EditorHistory）存在，但结构上不强制走它。

### 目标架构
1. **收口写边界（keystone）**：EngineHost **不再公开 `world`/`app`**；改为只暴露给 `SceneQuery`（读）与 `SceneCommands`（写）两个受信模块（同包 internal 约定或显式 token 注入）。面板一律经这两个门。
2. **所有写自动成 undo 步**：把 `EditorHistory.record` 内化进 `SceneCommands`——每个 mutating 方法默认开一个事务，调用方无法"忘记"登记。读写分离后，"裸 `world.set` 绕过 undo"在结构上不可能。
3. **命令对象化（接 RC10）**：把 SceneCommands 的每个操作表达为一个 `EditCommand` 值对象（复用引擎 `commands.ts` 命令类型），`apply(world)` 是唯一执行点。这让命令可序列化——为 RC10 的"editor→runtime 编辑命令 schema"、命令日志、未来 out-of-process 直接铺好路。

> keystone = 第 1 步：把 World 从事实全局降级为两个门后的私有句柄，是 E2 全部收益与 RC10 命令化的共同前置。

---

## E3：桥接是"伪轮询"——带了 payload 却全丢掉

### 病灶
- `EditorBridge` 的回调签名其实**携带了细粒度信息**：`onComponentChanged(entity, component)`（`context.ts:34`）、`onParentChanged(child, parent)`（`:37`）等都带实体与组件名。
- 但 `SceneStore.ts:26-42` 把**两个参数全忽略**，每次回调只 `revision++`/`structureRevision++`，然后所有面板 `useSyncExternalStore` 一律**全量重读**（`SceneQuery.readSceneTree` 重建整棵树、`readInspector` 重读整个组件集）。
- 本质仍是轮询，只是触发器从定时器换成了桥接回调。当前小场景无感，但：单字段编辑 → 全世界重读，**实体规模一上来即 O(n) 抖动**；且它**丢弃了 RC10"类型化变更事件信封"所需的 *what changed***。

### 目标架构
1. **细粒度脏标记**：SceneStore 改 `revision` 计数器为 `Map<entity, dirtyMask>`（mask 区分 structure / component-data / parent）。回调按 `(entity, component)` 标脏，面板只重读脏掉的实体/组件。`structureRevision` 已做的"结构 vs 数据"两档是正确的雏形，这是它的自然延伸。
2. **变更事件信封（接 RC10）**：把 bridge 回调归一为一个带版本戳的 `SceneChange` 事件类型（`{kind, entity, component?, parent?}`），SceneStore 消费它而非六个独立回调。这就是 RC10"runtime→editor 变更事件信封"的进程内形态——日后换 `postMessage`/SSE 只换传输、不换语义。

> E3 与 E2 互补：E2 规范 editor→runtime（命令），E3 规范 runtime→editor（事件），合起来即 RC10 的双向协议在进程内的最小落地。

---

## E4：无 edit / play 模式，编辑器 mutate 的是活动调度

### 病灶
- `EngineHost.ts:175` 调 `app.run()` 后，引擎**每帧 tick 所有系统**；编辑器编辑的是**同一个** World。没有任何 edit-mode / play-mode 状态。
- **引擎前提其实已就绪**：`app.ts:365 setPaused` / `:369 isPaused` / `:374`（单步 `step_pending_`）/ `:569`（pause 门控）齐全——编辑器从未接（与记忆中"Play/Pause 仍 pending"一致）。
- 今天不炸，**只因 `SceneLoader.ts:54 → loadSceneData` 把项目用户组件/系统全 SKIP**（`scene.ts:306` `Unknown component type` WARN）。一旦为"真正编辑项目 + 无损保存"（见 E6）去加载项目的组件/系统代码，那些 gameplay 系统就会**在编辑期运行、与编辑器的改动对打**（编辑器刚 set 的 Transform 被物理/动画系统下一帧覆盖）。
- 这是个**必须拍板的架构岔路**，不是 bug。

### 目标架构
1. **编辑器模式状态机**：`edit` / `play` / `paused` 三态，落在 `editorStore`；进 `edit` 即 `app.setPaused(true)`，进 `play` 解冻；Toolbar 接 Play/Pause/Step（引擎 API 已具）。
2. **"编辑期安全系统"分类**：edit-mode 下不能全停——渲染、变换层级、相机、拾取这类必须继续跑，gameplay（物理 tick、脚本、tween、粒子推进）必须冻结。需要给系统一个 `runInEditMode` 标注（或在 SystemSet 层面分组），让调度器在 edit-mode 只跑安全集。这是 E4 的真正工作量所在。
3. **play-mode 状态隔离**：进 play 前快照 World、退出时还原（借引擎已有的 `ChangeTracker` + scene 重建），让"试玩不脏化编辑场景"成立——同时这也是 E6 无损保存的前置（先能加载项目代码且不互相破坏）。

> 依赖：E4-2 的系统分类是"加载真实项目"的闸门；E4 一通，E6 的保存难题随之解开。

---

## E5：Schema 在接缝两侧各推一遍（RC9-1 的下游受害者）

### 病灶
- `schema.ts:113-129 inferField` 靠**逐字段嗅探 live JS 值的形状**反推控件类型（数字/bool/vec2/vec3/quat→angle/color），因为 RC9 的富元数据（range/step/tooltip/enum/category）**从未活到 TS**（见 `REARCH_FRONTIER.md` RC9 病灶）。
- 直接症状：**枚举字段只能渲染成裸数字**（如 `Camera.projectionType`），因为引擎生成的 JS schema 不带 enum 元数据；`componentFields`（`schema.ts:68-77`）遍历 `def._default` 的 key，只能拿到值、拿不到约束。
- 编辑器侧 `HIDDEN_COMPONENTS`/`ORDER`/per-type 控件（`schema.ts:34-38`）属于合理的**展示策略**（编辑器该 own），但 `inferField` 在**替引擎补它本该提供的类型信息**——这是接缝错位，不是编辑器职责。

### 目标架构
1. **消费 RC9-1 的富元数据**：RC9-1 让 `ES_PROPERTY` 注解（range/step/tooltip/label/category/hidden/enum）透传到 TS `COMPONENT_META` 后，`inferField` 的形状嗅探退役为**读权威 schema**；enum 渲染成下拉、数值带滑条/范围、字段带 tooltip/分组。
2. **保持职责划分**：引擎 own"有哪些组件/字段 + 类型 + 约束"，编辑器 own"隐藏/标签/顺序/控件外观"。E5 不是把策略搬回引擎，而是**让类型信息从引擎流过来，编辑器停止猜**。

> E5 无独立 keystone——它**纯依赖 RC9-1**。RC9-1 一落地，这里是受益最直接的下游；在此之前 `inferField` 的启发式是可接受的临时桥。

---

## E6：生产打包未解 + 保存有损（结构性，非杂活）

### 病灶
- **打包未解**：wasm 经 `${location.origin}/wasm/...` 动态 import（`EngineHost.ts:122`）+ `locateFile: /wasm/${p}`（`:131`），场景/纹理经 `/scenes/...` 绝对路径 fetch。dev（http origin）能跑，`file://` 打包**必碎**（`EngineHost.ts:120-121` 注释已自陈）。这决定了 wasm/资产加载该怎么组织，是结构问题。
- **保存有损**：`serializeScene`（`scene.ts:330`）存在，但因 load 跳过未知用户组件（E4 病灶同源），直接回写原文件会**丢失这些组件**。所以 save 至今未做（与记忆中"save gotcha"一致）。

### 目标架构
1. **自定义协议 / 相对 base**：打包版用 Electron 自定义协议（如 `estella://wasm/...`）或相对 base 取代绝对路径，wasm + 资产走同一套解析；与 E1-2 的"按变体分目录"一并设计。
2. **无损保存依赖 E4**：保存正确性的前提是**加载项目的组件/系统代码**（这样 load 不再 SKIP），而那要求 E4 的 edit-mode 冻结先就位（否则加载即互相破坏）。在此之前，save 只能走 Save-As/新文件，**不可**回写覆盖含未知组件的原场景——这条约束应在 UI 上显式化，而非留给用户踩坑。

> **更正（2026-06-19）**：E6 此前默认"保存目标存在"，实则**踩空**——架构里没有"工程"一等概念，编辑器也没有写文件的机制。那块地基是 **E7**，是 E6 的真正前置。E6 收窄为"在 E7 的工程根 + fs 桥之上，把 `serializeScene` 写回 `assets/scenes/*.esscene`"。

---

## E7：工程 / 工作区模型（Project & Workspace）—— E6 的前置地基

> 取舍已拍板（2026-06-19）：根级 `project.esproj`（提交）+ `.esengine/workspace.json`（本地态）· 固定布局约定 + 清单可选覆盖 · fs 仅 Electron（IPC + 沙箱到工程根）。

### 病灶
- **架构无 "工程" 一等概念**：`examples/*`（全 18 个）有隐式约定 `{.esengine/settings.json, assets/{scenes,textures}, src/systems}`，但 `.esengine/settings.json` 仅 `{ "lastOpenedScene": "assets/scenes/main.esscene" }`，且**只是 `build-tools/tasks/examples.js` 生成示例的副产物**——SDK 零 project 抽象，编辑器从不读它。
- **编辑器无工程根**：`SceneLoader.loadInto` 从 `desktop/public/scenes/*.esscene`（`EngineHost.ts` 的 `DEFAULT_SCENE_URL`，dev 拷贝）fetch，不知道工程在哪、也没有"打开工程"流程。
- **无 fs 机制（机制层硬缺）**：`desktop/electron/preload.ts` 只 `contextBridge` 暴露 `getVersion / getPlatform / reportEngineStatus`——**无 readFile / writeFile / dialog / watch**。编辑器**物理上写不了文件**，只能 fetch `public/`。
- **后果**：E6 无损保存**无目标可写**；Content Browser 无真实 fs 来源（仍用 `src/mock/sceneData.ts`）；E4 留的"加载工程 `src/` 组件代码"**无家可依**。这是 Unity `Assets/`+`ProjectSettings/`、UE `.uproject`、Godot `project.godot` 那一层——Estella 只有 `.esengine/settings.json` 这个胚胎，没长成。

### 目标架构
1. **工程格式**（双文件，职责分离）：
   - 根级 **`project.esproj`**（JSON，提交进库）：`{ formatVersion, name, engineBuildId（接 E1）, layout? }`。`layout` 可选——缺省走固定约定，可逐项覆盖。
   - **`.esengine/workspace.json`**（编辑器本地/瞬态，建议 gitignore）：`{ lastOpenedScene, panelLayout, … }`。从现有 `.esengine/settings.json` 迁移（`lastOpenedScene` 搬过来）。
   - **固定布局约定**：`assets/scenes/*.esscene` · `assets/textures/*`(+`.meta` UUID) · `src/`（工程组件/系统代码） · `.esengine/`（本地态）。
2. **fs 桥（Electron IPC，沙箱到工程根）**：main 进程 `ipcMain.handle('project:open' | 'fs:read' | 'fs:write' | 'fs:readdir' | 'fs:watch')`；preload 经 `contextBridge` 暴露 `window.estella.project.*` / `window.estella.fs.*`；**所有 fs 路径校验落在已打开工程根内**（拒绝 `..` 越界 / 绝对路径逃逸），防渲染层任意读写。watch 用 chokidar。
3. **编辑器 Workspace 模型**（`desktop/src/project/`）：`ProjectStore`——`openProject(dir)`（选目录→读 `project.esproj`→设根→读 `workspace.json`→打开 `lastOpenedScene`）、路径解析（scene/asset 相对工程根）、`saveScene`（`serializeScene` → `fs.write` 到 `assets/scenes/*.esscene` = **E6 的落地**）。
4. **资产解析改走工程根**：`SceneLoader` 的 `@uuid:` 解析 + 纹理 manifest 从工程 `assets/` 经 fs 桥读，取代 `public/scenes` dev hack。AssetRegistry / `.meta` UUID 已就绪，只需把根从 public 换成工程根。
5. **分层**：工程是**编辑器/创作期**概念，落在 `desktop/`（`project.esproj` 的 schema/类型可放共享处）；引擎/SDK 保持 project-agnostic（运行时只吃打好的 bundle）。

### 与其他条目的关系
- **E7 是 E6 的前置**（保存目标 + 写文件机制）；接 **E1**（`engineBuildId` 进 manifest）；接 **E4**（`src/` 是工程组件/系统代码的家 → 加载后 serialize 不再 skip-unknown → 真·无损保存）；喂 **Content Browser**（真实 fs 来源，替换 mock）。

### 执行顺序（可拆、可独立验证）
- **E7-1 工程格式 schema**：`project.esproj` + `.esengine/workspace.json` 类型 + 固定布局约定 + 读取/校验/旧 `settings.json` 迁移。纯数据 + 主进程可测。
- **E7-2 fs 桥**：Electron IPC + preload 暴露 + 工程根沙箱校验。主进程单测（越界 reject、watch 回调）。
- **E7-3 Workspace 模型**：`ProjectStore`、路径解析、`SceneLoader` 改走工程根、打开工程流程。
- **E7-4 保存（= E6）**：`serializeScene` → `fs.write`，Save / Save-As UI；含 E4 加载 `src/` 后的真·无损覆盖。
- **examples 迁移**：`build-tools` 加一步把 18 个 examples 升级到新格式（生成 `project.esproj`，`settings.json`→`workspace.json`），保持可在编辑器打开。

### 验证机制
- **E7-1**：`project.esproj` 解析/校验往返 + 旧 `settings.json` 迁移测试（读胚胎 → 产出新格式 + workspace.json）。
- **E7-2**：fs 桥沙箱测试——工程根内读写 OK、`..`/绝对路径越界 **reject**；watch 触发回调。
- **E7-3/4**：打开 examples 工程 → 改场景 → 保存 → 重开，**逐组件一致**（含 E8 加载 `src/` 后原本会被 skip 的用户组件）。

---

## E8：动态加载工程脚本（Dynamic Project Scripts）—— 真编辑/无损保存的最后一块

> 这是贯穿全程的"加载工程代码"缺口的根治方案。E7 让编辑器能开工程、读场景；但工程的**自定义组件/系统**（`src/components.ts`、`src/systems/*.ts`）从不被加载，导致它们在 load 时被 skip、不可编辑、无损保存被卡、play 时不运行。

### 病灶
- **零动态加载**。用户组件靠**静态 import 进 bundle**：`src/main.ts` `import './components'`（`defineComponent('Wave', …)` 在模块加载时注册）+ `import {waveSystem} from './systems'` + `addSystemToSchedule(…)`。每个 example 由发布构建打成自包含 bundle，组件在 bundle 加载时进 registry。
- `runtimeLoader.ts` 是**发布期场景/资产加载器**，不加载用户代码（它假设组件已被 bundle 注册）。
- 编辑器只 `fs.read` 场景 JSON、从不加载工程 `src/` → `getAllRegisteredComponents()` 里没有 Wave/Orbit/FlipDemo → `loadSceneData` skip（`scene.ts:306` WARN）→ 不可见/不可编辑/无损保存被守卫挡住/play 不跑。
- **仓内没有"把用户 src 打成可运行 bundle"的流水线**（`build` 只构建引擎 wasm/sdk；`check-examples` 只 typecheck）。所以编辑器的工程脚本构建是**新建**的。

> **命门**：`defineComponent` 注册进 `getDefaultContext().componentRegistry`（`component.ts:129`），编辑器 `getAllRegisteredComponents()` 读它。**工程代码 import 的 `esengine` 必须与编辑器是同一个模块实例**（同一个 `getDefaultContext`），否则注册进另一个 registry，编辑器看不到——这是整套设计的成败点。

### 目标架构
1. **工程脚本构建（esbuild，主进程）**：编辑器用 esbuild（Node API）把工程的脚本入口（`src/main.ts` 或一个约定的注册入口）bundle 成 **单个 ESM**，关键是 **`external: ['esengine','esengine/*']`**——不把 esengine 打进去。产物写到工程的 `.esengine/cache/`（本地、gitignore）。新 IPC `project:buildScripts` → 返回产物路径 + 诊断。
2. **共享 esengine 实例（import map）**：渲染进程注入一个 import map，把裸 `esengine` 映射到**编辑器已加载的那个 esengine 模块 URL**。`import(产物URL)` 时,产物里的 `import {...} from 'esengine'` 经 import map 解析到同一实例 → 工程的 `defineComponent`/`addSystemToSchedule` 注册进编辑器的 `getDefaultContext()`。
3. **加载时序**:`open project` → **先 buildScripts + import(产物)**(注册组件/系统)→ **再** load 场景(`resetWorldTo`)。这样 `loadSceneData` 时组件已在 registry,不再 skip → 工程组件可编辑、可序列化(接 E7-4 → 真·无损覆盖,lossy 守卫从"挡"变"放行")。
4. **用户系统的 edit/play 门控(接 E4)**:工程 `main.ts` 调的是裸 `addSystemToSchedule`(不门控)。编辑器加载工程代码时**自动给工程注册的系统包上 `playModeOnly`**(edit 模式冻结、play 才跑)——可在 flush pending systems 时按"来源=工程"打标。否则用户系统会在编辑期乱跑、和编辑器对打。
5. **脚本 HMR**:监视工程 `src/`(chokidar,接 E7 fs 桥)→ 改动 → 重 buildScripts → **重置 + 重注册**(`unregisterComponent` 已存在;或 `getDefaultContext()` 局部重置用户组件 + 重 import 带 cache-bust 的产物 URL)→ 重载当前场景。调参/改组件即时生效。
6. **隔离/安全**:工程 JS 在编辑器渲染进程里执行,能摸到 `window.estella`(fs 桥)。本地开发工具、用户主动打开的工程,风险可接受;**记为已知** + 未来可选:把工程脚本跑在 Web Worker / 独立 realm(但跨 realm 共享 registry 复杂,需权衡)。

### 需要拍板的岔路
| 岔路 | 选项 | 推荐 |
|---|---|---|
| **构建工具** | esbuild(主进程,快,Node API) / Vite 中间件服务(白送 HMR 但服务工程外文件别扭) / 复用某发布构建 | **esbuild**:最简、最快、external 控制精确;HMR 自己接 watch |
| **共享 esengine** | import map(Chromium 原生) / 全局注入 `window.__esengine` / SystemJS | **import map**:标准、干净 |
| **系统门控** | 编辑器自动给工程系统包 `playModeOnly` / 要求工程自己门控 | **自动包**:工程无需改代码,edit 期默认冻结 |
| **隔离** | 主渲染进程(共享 registry 最简,但工程 JS 拿得到 fs 桥) / Worker 沙箱 | **主渲染进程**(local 工具)+ 记风险;Worker 留后 |

### 执行顺序(可拆、每步可验证)
- **E8-1 esbuild 构建 + IPC**:`project:buildScripts`(external esengine,产物入 `.esengine/cache`)。主进程可单测(产出含 `import 'esengine'` 的 ESM、无内联 esengine)。
- **E8-2 import map + 动态 import**:渲染层注入 import map(esengine → 编辑器实例)+ `import(产物)`;验证工程 `defineComponent` 后 `getAllRegisteredComponents()` 含该组件。
- **E8-3 时序接入**:`ProjectStore.loadCurrentScene` 之前先加载脚本;验证开 sprite-rendering → Wave/Orbit **不再 skip**、inspector 可见可编辑。
- **E8-4 系统门控**:工程系统自动 `playModeOnly`;验证 edit 期工程系统不 tick、play 期跑(接 E4 的 run-mode 测试)。
- **E8-5 脚本 HMR**:watch src → 重建重注册重载;验证改 `components.ts` 默认值即时生效。

### 验证机制
- **E8-1**:bundle 产物断言——含 `from "esengine"`(external)、不含 esengine 源码内联。
- **E8-2**:加载一个最小工程脚本(`defineComponent('Probe',…)`)→ 断言 `getComponent('Probe')` 非空(证明共享了同一 registry/context)。
- **E8-3**:开含 Wave 的工程 → 断言 `loadSceneData` 零 "Unknown component type" WARN、该实体 inspector 列出 Wave 字段。
- **E8-4**:edit 期工程系统计数 0、play 期 >0(复用 E4 run-mode 断言)。
- **E8-5**:改 `Wave.amplitude` 默认值 → HMR → 新建实体取到新默认(无需重启)。

### 与其他条目的关系
E8 是 **E7-4 真·无损保存**的前置(加载工程代码 → serialize 不再丢未知组件 → lossy 守卫放行);接 **E4**(工程系统的 edit/play 门控);用 **E7** 的 fs 桥(读 src + watch)+ `.esengine/cache`(产物)。

---

## 执行顺序（按 ROI 排，全程保持构建常绿、每项独立验证）

| 档位 | 批次 | 依据 |
|---|---|---|
| **立即（独立 / 低风险 / 见效快）** | **E2-1/2** 收口写边界 + 写即 undo、**E1** build id 握手 + wasm 按变体分目录、**E3-1** 细粒度脏标记 | 纯重构/纯加法；E2 当下即消除"静默漏 undo"；E1 堵静默变体漂移；均不依赖大改造 |
| **keystone（解锁后续）** | **E4-2** 编辑期安全系统分类 | 它是"加载真实项目 → 无损保存（E6）"的总闸门；引擎 pause/step API 已就绪，工作量在系统分类 |
| **地基（E6 的前置）** | **E7** 工程/工作区模型（`project.esproj` + fs 桥 + Workspace）→ 然后 **E6** 无损保存 | 没有工程根 + 写文件机制，保存无目标可写、Content Browser 无真实源；E7 是 E6 物理前提 |
| **中长期（依赖前置 / 跨仓 / 需拍板）** | **E2-3 + E3-2** 命令/事件对象化（= RC10 进程内落地）、**E5** 富元数据消费（依赖 RC9-1） | 依赖 keystone 或 RC9-1；命令/事件化为未来 out-of-process 铺路 |

> 依赖序：E2-1（World 降级为私有句柄）是 E2 全部收益与 E2-3 命令化的前置；E4-2（系统分类）是 E4-3 与无损保存的前置；**E7（工程模型 + fs 桥）是 E6 的前置**；E5 纯依赖 RC9-1；E3-2 与 E2-3 合起来即 RC10。
> 核心判断：**先吃 E2/E1/E3-1 三个低垂果实（接缝收口 + 防漂移 + 细粒度刷新，纯重构/加法），同时把 E4-2 立为 keystone**——它解开"加载真实项目"这一步，E6 的保存随之成立。RC10 的协议化（E2-3+E3-2）作为其上的加法层，不插队。

---

## 验证机制（机制即根治成立的证明）

- **E1 产物绑定**：构造一个"故意旧 wasm + 新 SDK"场景，断言 boot **拒绝启动并指明变体/版本**（而非现在 hash-only 通过或静默错行为）；dev 守卫用"改 SDK hash 后 dev server 立刻红"验证。
- **E2 写边界**：结构测试断言**面板无法触达 `world`**（编译期：World 不在 EngineHost 公开 surface）；行为测试断言**任意 SceneCommands 调用后 undo 栈 +1**（不存在"绕过 undo"的成功路径）。
- **E3 脏标记**：断言"编辑实体 A 的一个字段 → 只有 A 的 inspector 重读，树/其它实体零重读"（重读计数断言）。
- **E4 edit/play**：断言 edit-mode 下 gameplay 系统**不 tick**（物理/tween 计数为 0）、渲染/变换**继续 tick**；play→edit 往返后 World 状态与进 play 前**逐字段一致**（状态隔离）。
- **E5 富元数据**：端到端往返——`ES_PROPERTY(enum=...)` → `COMPONENT_META` → inspector 渲染成下拉（与 RC9-1 验证共享）。
- **E6 打包/保存**：打包产物在 `file://`（或自定义协议）下成功 boot；"加载含用户组件场景 → 编辑 → 保存 → 重载"**逐组件一致**（含原本会被 SKIP 的用户组件）。

---

## 需要拍板的架构岔路

| 岔路 | 选项 A | 选项 B（推荐） |
|---|---|---|
| **接缝形态** | 立即上 `postMessage`/RPC 协议化 | **保持进程内直连，但收口为命令(E2)+事件(E3)两个门**；协议化(RC10)作为换传输不换语义的加法层 |
| **edit-mode 系统冻结** | 全停调度，渲染也停（编辑器自己画） | **系统分类：编辑期安全集(渲染/变换/相机/拾取)继续 tick，gameplay 冻结(E4-2)** |
| **保存策略（短期）** | 直接回写原 `.esscene`（会丢未知组件） | **未加载项目代码前只允许 Save-As / 新文件，UI 显式禁用覆盖保存**；无损覆盖待 E4+项目代码加载就位 |
| **wasm 变体管理** | 维持三变体覆盖同一目录 | **按变体分目录 + manifest，编辑器显式选变体(E1-2)** |
| **schema 富化** | 编辑器侧继续扩 `inferField` 启发式 | **等 RC9-1，消费权威元数据(E5)**；在此之前嗅探是可接受临时桥 |
| **工程清单（E7，已定）** | 扩 `.esengine/settings.json` 单文件 / 根级单文件 `estella.json` | **✅ 根级 `project.esproj`（提交）+ `.esengine/workspace.json`（本地态，gitignore）**；职责分离，像 .uproject + Library/ |
| **工程布局（E7，已定）** | 完全写死 / 完全清单驱动 | **✅ 固定约定（`assets/scenes`、`assets/textures`、`src/`）+ 清单可选覆盖** |
| **fs 访问（E7，已定）** | Electron + Web(File System Access) | **✅ 仅 Electron（IPC + 沙箱到工程根）**；编辑器本就 Electron-first |

---

## 实现进度（living status）

- **E2-2（写即 undo / 单一写门）：✅ 已实现（2026-06-19）。** 把 undo 记录从面板内化进 `SceneCommands`：新增 `beginGesture(label)`/`endGesture()`,raw writer 降为 module-private 函数 `applyFieldWrite`(未导出),公开 `setField`/`setEntityXY` **一律记 undo**——无 gesture 时各自成步,gesture 内按字段首触捕获 before、`endGesture` 读 after、合并为一步。`Details.tsx`(FieldRow)与 `Viewport.tsx`(拖拽)删除手动 capture+`EditorHistory.record`,改调 gesture API；`EditorHistory.record` 现仅存于 `SceneCommands`(6 处)。
  - **验证**：`tsc --noEmit`(strict + noUnusedLocals)+ 完整 `vite build` 绿；三条结构不变量 grep 确认——(1) 面板零 `EditorHistory.record`；(2) `applyFieldWrite` 未导出、仅 SceneCommands 内调用；(3) 面板/只读模块零 `world.set/insert/despawn/spawn`。行为等价(focus→blur / 拖拽 / 单击 toggle / 纯点选无误记 / undo·redo 经 raw writer 不重记)经逐场景推演。
  - **未尽(E2 余项)**：**E2-1 的"硬隔离"**——`EngineHost.app` 仍是公开 getter(引擎层 4 模块合法需要),`desktop/` 无 eslint,故"面板编译期不可触达 world"的 lint 强制延后;当前靠"raw writer private + 公开面只含记 undo 的方法"在结构上堵住主要裂缝。**E2-3(命令对象化,接 RC10)** 未开始。
- **E1（构建溯源 manifest + 编辑器 advisory guard）：✅ 已实现（2026-06-19）。** ① SDK 从 `esengine` 顶层导出 `ABI_LAYOUT_HASH`(`sdk/src/index.ts`,重建 dist);② 新增 `desktop/src/engine/EngineGuard.ts`——`evaluateManifest`(纯函数,可测)+ `checkEngineBuild`(fetch `/wasm/wasm.manifest.json`),比对 `abiHash`/`editorTarget`,warn-on-drift、缺失即 ok、**非 fatal**;③ `EngineHost.boot` 在实例化前调用 guard,warn/info 落控制台;④ `build-tools/tasks/sync.js` 每次 wasm 同步重写 `wasm.manifest.json`(abiHash 取自 `component.generated.ts`、gitSha 取自 `git rev-parse`、builtAt=now);⑤ backfill 当前二进制的 manifest(`desktop/public/wasm/wasm.manifest.json`,abi=`579120e76e895e7c` git=`dcdfda67`)。
  - **设计修正**：layout 漂移其实已被引擎 strict 握手(`app.ts:854`)**fatal 兜住**,故编辑器侧**刻意做成 advisory**(避免陈旧 manifest 误报挡 boot);新增价值是变体识别 + 构建溯源 + 实例化前/接缝处的早期告警。**按变体分目录**因"文件名不同本就共存"而重新评估为低优先,暂缓(需 launch-test)。
  - **验证**:编辑器 `tsc --noEmit` + `vite build` 绿(`ABI_LAYOUT_HASH` 从 dist 解析);SDK `rollup` 重建 + dist 含该导出;`node --check` sync.js 通过;guard 四分支语义(absent/match→ok、abi/variant 漂移→warn)经 node 复核;writer 正则从 SDK 源抽出真实 hash 且与 backfill manifest 一致(当前 boot 判 ok,零回归)。**未 launch-test** 运行时告警实际显示(仅编译 + 逻辑 + 无回归路径验证)。
- **E4（edit/play 模式收口 + 状态下沉 AppContext + 编辑器接线）：✅ 基础已落地（2026-06-19）。**
  - **关键更正**:edit/play 门控机制**早已存在**——`env.ts` 的 `playModeOnly()`（`= !editorMode || playMode`）+ `setEditorMode/isEditor/isRuntime/setPlayMode/isPlayMode`,且 **animation(tween/sprite)、physics step、timeline player、UI 交互(interaction/textinput/focus/drag)、audio、scrollview 早就用 `runIf: playModeOnly` 门控了**。我上一轮加的 `App.setEditMode`/`addGameplaySystemToSchedule` 是**并行的第二套真相**(正是 RC 反复点名的多源真相病根),已**全部回退删除**,统一到 `env.ts`。
  - **架构升级(不为兼容妥协)**:把 `env.ts` 的**模块级进程全局** `editorMode`/`playMode` **下沉进 `AppContext`**(与 `componentRegistry`/`editorBridge`/`pendingSystems` 同处);`env.ts` 函数签名不变、改为 `getDefaultContext()` 的薄访问层,`AppContext.reset()` 一并复位。**收益**:app-scoped 状态归一到一个 context、消除散落的模块全局、`setDefaultContext` 多-App 时自动隔离 run mode——与 RC 的 context 收口同一条线。这正是 A(env 语义)唯一弱于 B(实例状态)那一维的正确兑现方式。
  - **分类策略**(沿用既定 `playModeOnly`):推进时间/模拟者(物理 step、粒子/动画/tween/timeline/计时器)= gameplay 冻结;让场景可见可选者(render、transform、相机、UI layout/render-order、资产)= edit-safe 续跑。
  - **本轮补门控**:`ParticlePlugin`(ParticleSystem)、`timer`(TimerSystem)挂 `runIf: playModeOnly`(原先漏挂)。**spine 暂不动**——其 `spineUpdateSystem` 把"算姿势"与"按 dt 推进"耦合,整体 `runIf` 跳过可能导致 edit 模式不推姿势→渲染异常;正确做法是 **edit 模式传 `dt=0` 而非跳过系统**,但改 spine 内部我无法运行时验证渲染,故记为带方案的跟进。
  - **编辑器**:`EngineHost.boot` 调 `setEditorMode(true)`+`setPlayMode(false)`(开在 edit 态);`setRunMode(isPlaying,isPaused)` = `setPlayMode(isPlaying)` + `app.setPaused(playing&&paused)`;`App.tsx` useEffect 同步 `editorStore` 的 play/pause(Toolbar 的 Play 已接 `togglePlay`)。
  - **验证**:新增 `sdk/tests/run-mode.test.ts`(5 用例:默认 runtime、edit 冻结/play 放行、状态在 AppContext 上 + reset、调度器跳过门控系统/edit-safe 续跑、runtime 恒跑)→ **全 SDK 套件 2158 passed**(零回归——证明 env→AppContext 重构不影响 6 个用 `playModeOnly` 的现成插件);编辑器 `tsc --noEmit` + `vite build` 绿;dist 已无 `setEditMode`/`addGameplaySystemToSchedule`(并行机制彻底退干净)。**未 launch-test** 真实运行时冻结表现。
  - **未尽(E4 跟进)**:① **spine** 改 `dt=0`-in-edit(而非跳过);② **E4-3 play 态状态隔离**(进 play 前快照 World、退出还原),是 **E6 无损保存**前置;③ Toolbar 的 Pause/Step 接 `togglePause`/`stepFrame`;④ (可选,长线)把 run mode 进一步做成 ECS Resource 供 `Res()` 读取——但需改 runIf 模型,收益有限,暂不做。
- **序列化现代化(= `REARCH_FRONTIER.md` RC9-2,E4-3 的前置):✅ 已落地(2026-06-19)。** 评估 `scene.ts` 后发现核心机制(两趟加载 + id 重映射 + 反射驱动实体/资产字段 + 层级单一真相)规范现代,但迁移/版本与 load 副作用有真债。本轮根治:
  - **版本化迁移框架**(抬 `prefab/migrate.ts` 模式):新增 `migrateSceneData(raw) → {data, migrated, fromVersion, toVersion}`——读 `version`(此前死字段)、**版本过新即拒绝**、盖 `SCENE_FORMAT_VERSION`;那 4 个散落硬编码迁移(`migrateToUIRenderer`、`Local/WorldTransform→Transform`、`UIRect.anchor→anchorMin/Max`、`UIMask.mode` 串→int)收编为幂等、shape-driven 的迁移步,`loadComponent` 变纯(只 validate+insert)。
  - **load 不再变异输入**:`migrateSceneData` JSON 深克隆(`prefab/clone.ts` 同款、全平台安全),`loadSceneData`/`loadSceneWithAssets` 全程操作克隆——**快照可反复重载**(直接解 E4-3 的快照复用)。
  - **组件序列化 codec 注册表**(#3):`registerSceneComponentCodec(type, {exportData, outOfBandFields, importData})` 替换硬编码的 TilemapLayer 特例;`tilemapPlugin` 注册 chunks codec。**`scene.ts` 自此零 tilemap 耦合**,通用序列化器不再认识任何具体组件。
  - **验证**:`migrateSceneData` 8 用例(各迁移 / migrated 标志 / 版本盖戳 / **拒绝过新** / **非变异**)+ codec out-of-band 往返用例;**全 SDK 套件 2161 passed**(净 +3,零回归——证明对 scene/tilemap/prefab/所有用 load 的路径无影响);3 个旧 `loadSceneWithAssets` 测试从"断言输入被原地改"改为断言真实结果(spawned handle);编辑器 build 绿。
  - **未尽**:`visible===false` 仍会丢实体(半成品输入字段,语义混乱)+ 二进制/delta 编码——记为后续。
- **E4-3(play 态状态隔离):✅ 已落地(2026-06-19)**,建在上面的非变异序列化地基上。
  - **引擎**:新增可复用原语 `resetWorldTo(world, sceneData)`(despawn 全部 + `loadSceneData`,返回 old→new 映射);因 `loadSceneData` 已非变异,同一快照可反复还原。
  - **编辑器**:`EngineHost.setRunMode` 检测 edit↔play 跳变——进 play 时 `serializeScene(world)` 快照、Stop 时 `resetWorldTo(snapshot)` 还原,返回 `restored` 布尔;`App.tsx` 在 restored 时 `select(null)`(还原后实体 id 变,选择失效)。**试玩不再脏化编辑场景。**
  - **验证**:`resetWorldTo` 2 用例(despawn-all + reload 把 mutate 过的世界还原到快照、同一快照反复还原)→ **全 SDK 套件 2163 passed**(零回归);编辑器 build 绿。**未 launch-test** 真实试玩→Stop 的视觉还原。
  - **未尽**:还原后**选择重映射**(现在直接清空;`loadSceneData` 返回的 old→new 映射 + `EntityHandles` 可做精确重映射);play 态**资源**状态(Time 等)不快照(仅实体/组件)——对编辑足够,记为已知边界。
- **E4 全量分类剩项**:animation/spine/timeline/audio 等其余 gameplay 系统的 `playModeOnly` 打标(spine 需 `dt=0`-in-edit 而非跳过)。
- **E7-1(工程格式)+ E7-2(fs 桥):✅ 已落地(2026-06-19)。** 取舍已拍板并实现(不做旧 `settings.json` 兼容读取层——按"现代化、不为兼容妥协")。
  - **E7-1 格式**:`desktop/src/project/format.ts`(纯 TS、零 node/electron 依赖,main+preload+renderer 共用)——`ProjectManifest`(`project.esproj`:formatVersion/name/engineBuildId/layout?)、`WorkspaceState`(`.esengine/workspace.json`)、`ProjectLayout` + `DEFAULT_LAYOUT`(`assets/scenes`、`assets/textures`、`src`)、`parseManifest`(校验 + **版本过新即拒绝**,镜像 scene 迁移)、`resolveLayout`(默认 + 清单覆盖)。
  - **E7-2 fs 桥**:`desktop/electron/projectFs.ts`(main 专用,node fs)——`openProject`(读 + 校验 `project.esproj`,载 workspace)、`readInRoot/writeInRoot/readDirInRoot/saveWorkspace`,全部经 **`resolveInRoot`** 沙箱(`..`/绝对路径越界 reject)。`main.ts` 持有 `projectRoot`(权威在主进程)+ 注册 `project:openDialog|open`、`fs:read|write|readdir`、`workspace:save`;`preload.ts` 经 `contextBridge` 暴露 `window.estella.{project,fs,workspace}`(fs 路径均工程根相对)。
  - **验证**:`resolveInRoot` node 复核(工程内 OK、`../`/`assets/../../x`/绝对路径 reject)；编辑器 `tsc --noEmit` + `vite build`(main+preload+renderer 跨 IPC 类型)绿。**未 launch-test** 真实 dialog/IPC 读写往返(需运行 Electron)。
- **E7-3(Workspace 模型 + 打开工程):✅ 已落地(2026-06-19)。**
  - **examples 迁移**:18 个 example 目录全部转新格式(`project.esproj` 提交身份 + `.esengine/workspace.json` 本地态、保留 lastOpenedScene,删 `settings.json`)。作为真实工程 fixture。
  - **ProjectStore**(`desktop/src/project/ProjectStore.ts`):渲染层包 `window.estella.{project,fs}`——`openViaDialog`/`open(root)` → `adopt`(resolveLayout)→ `loadCurrentScene`(经 `fs.read` 读 `workspace.lastOpenedScene` → `@uuid:` blank 到 0 → **复用 `resetWorldTo` 载入活动 World**)。subscribe-able。
  - **接线**:`App.tsx` 加 **Cmd/Ctrl+O** → `ProjectStore.openViaDialog()`(成功后 `select(null)`,因 id 变)。**加法式**:EngineHost boot 仍走 public/scenes 默认(不破现有路径),"打开工程"是叠加能力。
  - **验证**:examples 迁移脚本已跑 + 抽查无误;编辑器 `tsc`+`vite build` 绿(ProjectStore 跨 IPC 类型、`window.estella.project/fs`、resetWorldTo/SceneData)。**未 launch-test** 真实 dialog→fs.read→resetWorldTo 往返(需 Electron)。
  - **本轮限制**:工程纹理 `@uuid:` 暂 blank 到 0(纯色)——真纹理需 **E6-1 自定义协议**(`estella://` 服务工程根,顺带解 file:// 打包);StatusBar 未显示工程名(ProjectStore 已 subscribe-ready)。
- **E7-4(保存 = E6):✅ 已落地(2026-06-19)。** open↔save 闭环成形。
  - **无损守卫(核心)**:load 时 `unknownComponentTypes(scene)` 比对场景组件类型 vs 引擎注册表;含未注册类型(如 Wave/Orbit/FlipDemo,其 `src/` 代码未加载)即标 `lossy`。**`save()`(覆盖当前场景)在 lossy 时拒绝**——避免静默 clobber 掉 load 时被 drop 的组件(正是贯穿全程的 E6 gotcha)。
  - **ProjectStore**:`serializeCurrent`(`serializeScene(world, name)`)、`save()`(覆盖,lossy 守卫)、`saveAs(rel)`(显式写新路径,无守卫)、`saveAsViaDialog()`(经 `project.saveSceneDialog` 选目标);保存后 `workspace.lastOpenedScene` 持久化(`workspace:save`)。
  - **Save-As 对话框**:main `project:saveDialog`(`showSaveDialog`,**校验目标在工程根内**,返回工程相对路径);preload 暴露 `project.saveSceneDialog`。
  - **接线**:`App.tsx` **⌘S**(覆盖,失败/有损时自动转 Save-As)/ **⇧⌘S**(Save-As)。
  - **验证**:编辑器 `tsc`+`vite build` 绿(save/saveAs 跨 IPC、`serializeScene`/`getComponent`)。**未 launch-test** 真实 ⌘S→serialize→`fs.write`→落盘往返(需 Electron);`serializeScene` 本身 SDK 2161 测试覆盖、fs.write+沙箱 E7-2 已验。
  - **本轮限制**:**真·无损覆盖**(含用户组件)仍需加载工程 `src/` 组件代码——未做,故 lossy 场景只能 Save-As(守卫正确地挡住覆盖,而非冒险放行)。
- **E6-1(`estella://` 自定义协议 + 工程纹理):✅ 已落地(2026-06-19)。**
  - **协议**(`electron/main.ts`):`registerSchemesAsPrivileged`(`estella`,standard/secure/supportFetchAPI/stream,app ready 前)+ `protocol.handle('estella', …)`(ready 后)——`estella://project/<rel>` → 经 `resolveInRoot` 沙箱读工程根文件、按扩展名给 content-type 返回 `Response`。**安全**:URL 解析把 `..` 钳制在 host 根(越不过 authority)+ `resolveInRoot` 双重守卫,越界不可能。CSP 加 `estella:`(connect-src + img-src)。
  - **纹理解析**(`ProjectStore`):load 时收集场景 `@uuid:` → 扫 `assets/textures/*.meta` 建 uuid→path(仅被引用的)→ `assets.loadTexture('estella://project/<path>')` 得 handle → `mapAssetRefs` 把 ref 换成 handle(`HttpBackend.fetchBinary` 走 `fetch`,协议可拦)。**save 反向**:记 handle→uuid,`serializeCurrent` 按 `getComponentAssetFields` 把纹理字段 handle 还原成 `@uuid:`(只动资产字段,不误伤 layer/size),保存仍可移植。
  - **验证**:协议 URL→relpath 沙箱 node 复核(`..` 经 URL 规范化钳在根内);编辑器 `tsc`+`vite build` 绿(main 侧 Response/URL/protocol、ProjectStore 纹理解析+反向跨 IPC)。**未 launch-test** 真实 fetch→GL 上传→显示 + open→改→save 往返(需 Electron)。
  - **本轮限制**:仅纹理(material/font `@uuid:` 仍 blank 到 0,其 dir 未扫);textures 仅扫 `layout.textures` 顶层(子目录待递归);wasm 仍走 public(协议可复用于 file:// 打包,留待打包任务)。
- **E6:✅ 达成**(open↔save + 工程纹理显示;真·无损覆盖待加载工程 `src/` 代码)。
- **E7-5(Launcher / 项目浏览器,静态 UI):✅ 已落地(2026-06-19)。** 编辑器启动先进 Launcher(借 UE5 Project Browser 结构:Recent / New-from-template / Open),套 Estella "stellar instrument" 身份(`launcher.css` 全用 tokens:淡星场背景、hover `--star-glow`、左轨静态星座 signature)。`desktop/src/launcher/Launcher.tsx`(Recent/New 双视图,mock 数据)+ `editorStore.showLauncher`(默认 true,`enterEditor` 切编辑壳)+ App.tsx gating。**静态**:卡片/Open/Create 暂只 `enterEditor()`;待接 **recents IPC**(`userData/recents.json`)、**`project:createFromTemplate`**(拷 example + 写 `project.esproj`)、真缩略图(经 `estella://` 读 example `thumbnail.png`)、gating 改由 `ProjectStore.hasProject` 驱动。编辑器 build 绿。**未 launch-test** 视觉。
- **E3 / E5：📋 已立项**,未开始。
- **E7-6(Launcher 接线 + 工程格式收口):✅ 已落地(2026-06-19)。**
  - **接线**:Recent/Open/New 全接 `ProjectStore`——`recents:list/add`(`userData/estella-recents.json`,真缩略图 data URL + 构建徽章)、`templates:list`(列 examples)、`project:createFromTemplate`(拷模板+改 manifest name)、`project:chooseDirectory`;时序经 `EngineHost.setSceneBootstrap`(工程场景在引擎 ready 后加载、纹理走 `estella://`,不再默认 public 占位)。
  - **格式收口(纠错)**:我此前自造的 `project.esproj` 是**重复格式**——既有 `project.esproject`(被 build-tools 当工程标记、含 `defaultScene`/`designResolution`/`spineVersion` 等运行时字段)才是单一真相。**统一到 `project.esproject`**:并入我的 `formatVersion`+迁移/拒绝过新 + 提交身份 vs 编辑器本地态分离(`.esengine/workspace.json` 只放 lastOpenedScene/panel),schema 重写为并集(formatVersion/name/version/engineBuildId/defaultScene/designResolution/spineVersion/layout/description/tag,丢 churny 的 modified/created)。`format.ts`/`projectFs`/`launcher`/`ProjectStore` 全改读 `.esproject`;**删掉 18 个 examples 里我造的 `.esproj` + `workspace.json`**,把它们的既有 `.esproject` 重写成统一 schema(build-tools 只检存在、不受影响)。白赚:编辑器用上 `defaultScene`(真入口场景)+ `designResolution`(可驱动 viewport)+ `engineBuildId`(接 E1)。
  - **验证**:编辑器 `tsc`+`vite build` 绿;迁移脚本已跑、18 个 `.esproject` 统一、无残留 `.esproj`。**未 launch-test** 真实开/建工程往返。
- 下一步建议:**加载工程 `src/` 组件代码**(动态加载——解开真·无损覆盖 + 跑用户系统,接 E4;当前零动态加载,用户组件靠静态 import 进 bundle);或 **E3-1 细粒度脏标记**;或收尾(模板 description/tag、material/font 协议解析、工具栏激活态)。**强烈建议先 launch-test 一轮**给 E7+E6-1 真实验证。
- 与既有文档的关系：E3/E2-3 是 `REARCH_FRONTIER.md` RC10 的进程内具体化；E5 依赖 RC9-1；本文不改 RC7/RC8 的引擎内部现代化排序。
</content>
</invoke>
