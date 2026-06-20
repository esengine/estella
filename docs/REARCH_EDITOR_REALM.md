# Estella 隔离 Play Realm + Schema 即产物 —— 最优编辑器架构的兑现(RC12 §E8 / N6)

> 目标读者:引擎维护者 / 编辑器作者 / AI 协作代理。
> 体例同 `REARCH_ENGINE_INSTANCING.md` / `REARCH_SERIALIZATION.md`:描述目标架构与根治路径。
> 现状审计见各小节"病灶"引用的 `file:line`(2026-06 三路并行只读审计)。
> **立项缘由**:这是本轮工作的**会话原始目标 E8(动态加载工程脚本)的最优实现**,也是 `RC12_EDITOR_SEAM.md` 最优编辑器架构的兑现点。两条地基腿已就绪——① 引擎实例化(`REARCH_ENGINE_INSTANCING.md`,每 realm 一份 context)+ ② 无损序列化(`REARCH_SERIALIZATION.md`,SceneModel 真相 + 给 realm 喂快照)——本文把它们合拢成"**编辑器主 realm 零执行工程代码**:跑工程靠隔离 play realm(= 出货 runtime),编工程靠 schema 即产物"。

---

## 0. 核心诊断:最优架构已解锁,缺的是工程流水线 + realm 外壳

`RC12 §E8` 的原设计是"把工程代码 import 进编辑器 realm"(import-map 共享 esengine 实例),其命门是脆弱的模块同实例。审计确认有更优解,且现在可做:

- **跑工程 = 隔离 play realm**:按 Play 时在独立 realm(各自一份 wasm)里跑**出货 runtime**,加载工程的真实 bundle(含自定义组件/系统),喂当前场景快照 → **play==ship**,且不依赖 import-map 同实例。
- **编工程 = schema 即产物**:从工程构建出一份组件 schema(`schemas.json`),编辑器读它给未知组件建 inspector,**主 realm 不执行任何工程代码** → 崩溃/安全/重载隔离都由"物理"(独立 realm + 纯数据 schema)保证,不靠约定。

**根治原则**(承接 RC 系列):编辑器主 realm 对工程代码**零执行**;隔离由 realm 边界(物理)+ 纯数据 schema 强制,而非 import-map 约定。

---

## 1. 已具备、可直接复用(好消息)

- **出货 runtime 核心链**:`sdk/src/runtimeLoader.ts` 的 `initRuntime`(`:581`)/`loadRuntimeScene`(`:470`)是 **provider 抽象**的场景+资产装载,`flushPendingSystems(app)`(`:584`)把工程系统刷入,`app.run()`(`sdk/src/app.ts:481`)跑帧。playable/wechat 都只在外围(wasm 实例化 / 谁建 app / 资产来源)不同,核心共享。**play realm 直接复用这条链,无需改。**
- **工程代码注册机制**:`defineComponent` 写 `AppContext.componentRegistry`(纯 JS,`component.ts:132-150`),`addSystemToSchedule` 只 push 进 `pendingSystems`(只入队不执行,`system.ts:177`),靠 bundle 的 import 副作用触发 + `flushPendingSystems` 注册。
- **schema 可纯 node 提取**:`defineComponent`/`AppContext`/`createComponentDef` **全链纯 JS、零 wasm**(复核 `component.ts:128-150`、`context.ts:53-87`);system 只入队不跑。故 `new AppContext()` → import 工程声明入口 → 读 `getUserComponents()`(`component.ts:237`)→ 序列化 schemas.json,可在纯 node 跑。
- **无损未知组件已留存**:`SceneModel`(`desktop/src/engine/SceneModel.ts`)已无损保留未知组件 `{type,data}`;只缺"字段 schema"这一半。
- **控件推断已是纯数据**:`inferField`(`desktop/src/engine/schema.ts:124`)能从默认值推断 vec2/vec3/color/angle/number/bool/string。
- **现成 runtime-host 范式**:`templates/web/index.html:51-80` 是一个独立 html:`import('esengine.js')` → `createWebApp` → `main(Module)` → swallow `'unwind'`。play realm 的 host 页照抄。
- **快照 = 纯 JSON**:`SceneData`(`scene.ts:45`)结构化克隆安全,`SceneModel.serialize()` 直出,过 postMessage/IPC 干净。
- **CSP 已就绪**:`desktop/index.html:7` 已放行 `worker-src 'self' blob:`、同源(`'self'`)iframe(无 `frame-src` → 落到 `default-src 'self'`,同源 iframe 允许、`estella:` iframe 被挡)。

---

## 2. 病灶 / 缺口(file:line)

### G1:工程脚本构建流水线**完全缺失**(E8-1)
- `build-tools/cli.js` 的 `build`(`:25`)只构建引擎 wasm+SDK,**不碰工程 src/**;`examples` 任务(`tasks/examples.js:75`)只把工程目录**原样 zip**(给"导入模板"用),不编译;`check-examples`(`tasks/check-examples.js:91`)只 `tsc --noEmit`。
- esbuild **未作直接依赖**(根/desktop/sdk package.json 均无);唯一声明在 `templates/package.json:14`,其 build 脚本 `npx esbuild src/main.ts --bundle --format=esm`(`templates/package.json:6`)—— **没有 `--external:esengine`**(把 esengine 整个打进),产物去 `build/js/` 而非 `.esengine/cache`,与 E8-1 设想不一致。
- 编辑器侧 `desktop/src` **零 import/eval 工程代码**;`.esengine/` 只有 `workspace.json`(`format.ts:21`),无 `cache`。`schemas.json` 全仓不存在。

### G2:入口约定缺失(声明 vs 启动混在一起)
- `examples/*/src/main.ts` 把"声明"(`import './components'`)和"启动"(顶层 `addSystemToSchedule` + 函数里 `createWebApp`/`run`)混在一起;`components.ts` 单独(只 defineComponent,无启动)。无强制约定,提取器无稳定入口。

### G3:play realm 入口 + host 页缺失
- 出货 runtime 的场景来自打进 bundle / 从文件读(`playableRuntime.ts:33`、`wechatRuntime.ts:202`),**没有"接收编辑器快照"的入口**。无 play.html。

### G4:realm 外壳与通道缺失
- 编辑器引擎跑在**主 renderer 进程**(`EngineHost.ts`),无 iframe/worker 隔离。play/stop 是同进程翻 `playMode`(`EngineHost.setRunMode:144`)。
- `electron/main.ts` 单 `BrowserWindow`,`setWindowOpenHandler` **deny 所有 window.open**(`:82`);`estella://` 绑单一 `projectRoot`(`:103`);preload 桥(`preload.ts:49`)**无 realm 间消息通道**(只有 invoke 请求/响应)。
- 主↔realm 的**快照/控制/观测通道不存在**。

### G5:生产 file:// 的引擎加载 bug(前置)
- `EngineHost.ts:196` `import(\`${location.origin}/wasm/esengine.js\`)` 在 dev(http)可用;生产 `win.loadFile`(`main.ts:91`)→ `location.origin='file://'` → 解析成 `file:///wasm/...`(文件系统根),**找不到 glue**。任何出货 runtime realm 必须先修这个(改相对路径或 `estella://`)。

### G6:inspector 绑定活 World,未知组件不可编辑
- `schema.ts:64` `inspectableComponents` 遍历引擎注册表 + `world.has` 过滤(`:67`);`SceneQuery.readInspector`(`SceneQuery.ts:71`)从 `world.get` 取值。未知组件不进 World → 永远不可见/不可编。

---

## 3. 目标架构

### 3.1 工程流水线(主进程 esbuild + 纯 node 提取)
- **工程 bundle**:editor 用 esbuild 把工程入口(`src/main.ts`)bundle 成单 ESM,`external: ['esengine','esengine/*']`,产物入 `.esengine/cache/`(本地、gitignore)。
- **schemas.json**:纯 node 提取步骤——`setDefaultContext(new AppContext())` → import 工程**声明入口** → 读 `getUserComponents()` → 序列化 `{name,isTag,default,colorKeys,assetFields,spineFields,entityFields}` 数组到 `.esengine/cache/schemas.json`。零 wasm、零 system 执行。

### 3.2 隔离 play realm(= 出货 runtime,play==ship)
- 一个**同源 `play.html`** runtime-host 页(照 `templates/web/index.html` 范式),在隔离 realm 里:加载 `/wasm/esengine.js`(各自一份 wasm)+ 经 **import map** 把 `esengine` 指向自己的 SDK + 加载工程 bundle(external esengine → 命中 import map)→ 触发工程 `defineComponent`/`addSystemToSchedule` 副作用 → `initPlayRealmRuntime(快照)` → `app.run()`。`setEditorMode(false)/setPlayMode(true)` = 真出货。
- **`initPlayRealmRuntime(config)`**(SDK 新增):收 `{module, canvas, sceneData, assets}` → `createWebApp` → `initRuntime({scenes:[{name,data:sceneData}],firstScene,provider})` → `app.run()`。几乎是 `initPlayableRuntime` 去掉 base64、场景换单个快照。`initRuntime`/`loadRuntimeScene` **不改**。
- 编辑器 Play:拼快照(`SceneModel` 的**原始 `@uuid:` SceneData**,不是 handle 解析后的)+ 资产 manifest(uuid→url 或 data-url)+ 工程 bundle URL → 送进 realm;Stop 拆掉 realm。替换 `setRunMode` 的同进程 play。

### 3.3 编辑器主 realm:零执行工程代码 + schemas.json 喂 inspector
- inspector 对 **builtin** 组件仍走引擎注册表 + World;对 **user/未知** 组件改从 `schemas.json`(字段定义)+ `SceneModel`(值)合流(`schema.ts` 的 `inspectableComponents`/`componentFields` + `SceneQuery.readInspector`/`getFieldValue`)。未知组件从"无损留存"升级到"可编辑"。写回走已有的 `SceneModel.setField`(对 user 组件只写模型,不写 World)。

---

## 4. 需要拍板的岔路

| 岔路 | 选项 | 推荐 |
|---|---|---|
| **realm transport** | (a) 同源 iframe(`play.html`,postMessage) / (b) 第二 BrowserWindow(IPC,进程级隔离) / (c) Web Worker(OffscreenCanvas) | **(a) 同源 iframe** 为主:可 docked 成"Game"面板、realm 隔离、WebGL 直跑、scene+资产+控制全走 postMessage(无需 preload/IPC 改动、play realm 不需 `window.estella`);加一条 `frame-src 'self'` CSP。**(b) BrowserWindow 作升级**:要进程级崩溃隔离时再上(原生复用 preload+estella://、file:// 最干净)。**(c) Worker 否决**:整套 boot/render/input 假设 DOM canvas+window,OffscreenCanvas 改造面大、收益小 |
| **工程 bundle 的 esengine** | external + import map / 打进 bundle | **external + import map**:play.html 注入 import map(`esengine`→自己的 `/sdk` 实例),工程 bundle external esengine。play realm 是独立 realm,一份 esengine 实例,无 RC12 §E8 的"编辑器 realm 同实例"脆弱性 |
| **schema 提取入口** | 约定声明入口(如 `src/components.ts` / manifest `scripts.register`)/ 扫描 defineComponent | **约定 + 强制声明/启动分离**:工程 manifest 加 `scripts.register` 指向纯声明模块(默认 `src/components.ts`);提取器**只 import 声明模块,不 import 启动**(避免顶层 createApp 崩)。examples 顺带迁移成声明/启动分离 |
| **资产送进 realm** | uuid→url manifest(realm 自己经 estella:// 取)/ data-url 内联随快照 | **uuid→url manifest**:realm 经 `estella://`(若 iframe 同源可 fetch)或编辑器代取后传 data-url。注意:快照必须是**原始 `@uuid:`**(handle 是 realm-local 的,`ProjectStore.ts:226`) |
| **file:// 修复(G5)** | 相对路径 / `estella://` / 自定义 app:// | **改相对路径 + 自定义协议兜底**:dev/prod 都可达;这是 realm 与生产打包的共同前置 |

---

## 5. 迁移序(分阶段,每段可验证)

### Phase P —— 工程流水线(原始 E8 的地基;纯主进程/node,无 GUI,可单测)
- **P1 工程 bundle(E8-1)**:editor 主进程 esbuild,external esengine,产物入 `.esengine/cache`;IPC `project:buildScripts`。验证:产物含 `from "esengine"`、不内联 esengine(读 metafile 断言)。
- **P2 schemas.json 提取**:纯 node `new AppContext()` → import 声明入口 → 读 `getUserComponents()` → 序列化。验证:对一个含 `defineComponent('Wave',…)` 的工程,schemas.json 含 Wave 字段/默认值;零 wasm。
- **P3 入口约定**:manifest `scripts.register` + examples 迁移成声明/启动分离。验证:提取只 import 声明模块、不触发启动。

### Phase E —— 主 realm 编辑未知组件(接 schemas.json + SceneModel,纯 TS,可单测)
- **E1 inspector 读 schemas.json**:`schema.ts` 对 user/unknown 组件用 schemas.json(字段)+ SceneModel(值);builtin 不变。验证(desktop vitest):open 含未知组件场景 + schemas.json → inspector 列出该组件字段、可编辑、SceneModel 写回、保存无损。

### Phase R —— 隔离 play realm(GUI 重,需跑 Electron 验证)
- **R0 修 file://(G5)**:EngineHost glue 路径改相对/协议。
- **R1 play.html + initPlayRealmRuntime**:SDK 加入口(复用 initRuntime);play.html host 页 + import map。验证:play.html 独立加载 wasm + 一个快照 + 一个工程 bundle 能跑。
- **R2 编辑器 Play → realm**:Play 拼快照+资产 manifest+bundle → iframe;postMessage 控制(play/pause/stop)+ 观测;Stop 拆 realm。替换 `setRunMode` 同进程 play。验证(Electron 冒烟 + 可加 e2e):Play 跑出工程自定义系统(play==ship)、Stop 干净、编辑场景不被 play 污染。

---

## 6. 验证机制
- **P1**:bundle metafile 断言(external esengine、无内联);主进程单测。
- **P2**:纯 node 提取单测——含 `defineComponent` 的工程 → schemas.json 字段正确、不含 builtin、零 wasm。
- **E1**:desktop vitest——未知组件场景 + schemas.json → `inspectableComponents` 含该组件、`readInspector` 列字段、`setField` 写 SceneModel、保存无损(接现有 `engine-model-sync` 网)。
- **R**:Electron 冒烟/e2e——Play 跑工程系统、Stop 还原、编辑态不被污染、realm 崩不拖垮编辑器(iframe 内 throw 不杀主 realm)。
- **回归**:SDK 全量 + desktop vitest + editor build 常绿。

---

## 7. 与其他条目的关系
- **会话原始目标 E8 的最优落地**:跑工程(play realm = 出货)+ 编工程(schemas.json),取代 RC12 §E8 的 import-map 同实例方案。
- **吃掉两条地基腿**:① 实例化(每 realm 一份 context)+ ② 无损序列化(SceneModel 快照、原始 @uuid:)——本文是它们的汇合点。
- **接 E2**:命令边界复用;user 组件的编辑只写 SceneModel(World 不认),撤销/重做沿用。
- **play==ship**:R2 让 play 走出货 runtime,彻底取代同进程翻 playMode。
- **零 ABI**:纯 SDK/编辑器/构建工具 + esbuild(新依赖);不动组件布局/哈希。
