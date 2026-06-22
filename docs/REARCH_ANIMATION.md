# Estella 动画 / Sequencer 重构 —— 反射写入 · 纯 TS 运行时 · 文档即真源（REARCH_ANIMATION）

> 目标读者：引擎维护者 / AI 协作代理。
> 体例同 `REARCH_SPINE.md` / `REARCH_EDITOR_MODEL.md`：描述**目标架构**与根治路径，而非现状；
> 现状审计见各小节"病灶"引用的 `file:line`（2026-06 三路并行只读审计 + 交叉印证）。
> **立项缘由**：设计稿（`design/ue5-animation.html` + `ue5-overview.html#botDock`）里的 **UE Sequencer**
> 从未被搬进编辑器；而引擎那套 timeline runtime 当年是**临时实现**，用户明确"不够最佳现代就连引擎一起重构"。
> 本文把"补一个编辑器面板"升级成"把整条动画求值链收口成一套现代化架构"。
> **决策（用户已定）**：① Timeline 运行时改为**纯 TS**（文档即运行时）；② **编辑器优先**交付。
> **执行纪律**：终态删掉 C++ 临时实现与重复，不为兼容保留旧路径；分阶段只为每步可验证。

---

## 0. 核心诊断

**真正的分界线不是"动画该不该有编辑器"，而是"动画求值该不该和引擎已有的权威反射层合流"。**

引擎**已经有**一套引擎权威的"按字段路径读写任意组件"的反射层（序列化 + Inspector 都在用）：
TS 侧 `PTR_LAYOUTS`（组件→字段偏移描述）+ `BuiltinBridge.writePtrField/readPtrField`（按偏移读写 WASM 堆）+
`COMPONENT_META.animatableFields`（引擎权威的可动画字段表，与下文枚举**同源于** `ES_PROPERTY(animatable)`）。

而 timeline 却**另起炉灶**：把可动画目标硬编码成 `AnimTargetField` 枚举 + 一个 ~40 路 `switch`，并且把运行时切成
**C++ 求值 / TS 持文档**两半、靠每帧轮询结果缓冲同步。`AnimTargetField::CustomField` 这条"反射兜底"分支本身
就证明了枚举是多余的——既然兜底能反射，全部都能反射。

**三条事实定调：**
1. **side-effect 本就大多必须过 JS**：音频=WebAudio 纯 JS（`sdk/src/audio/Audio.ts`）、spine=side-module 经 JS 桥
   （`sdk/src/spine/ModuleBackend.ts`）、SpriteAnimator=纯 TS（`sdk/src/animation/SpriteAnimator.ts`）。
   也就是说 C++ timeline 里**唯一**非 JS 的工作只剩"属性曲线求值"。
2. **属性求值搬到 TS 几乎零成本**：写入直接走 `writePtrField` 戳 WASM 堆（不经 embind 拷整结构），
   authored 序列实例数很少，逐帧求值在 JS 完全可忽略；现有自定义属性分支早就在 TS 求值
   （`TimelineRuntime.ts` `setNestedProperty` + `world.set`）证明可行。
3. **批量程序化补间另有归宿**：Tween（`src/esengine/animation/TweenSystem.cpp`）是 C++ 批量快路径，
   服务"成千上万个简单补间"；authored Sequencer 序列是"少量、富功能"——两者尺度不同，不必同核。

**结论：属性求值统一到反射写入层；Timeline 运行时纯 TS 化（文档即运行时）；Tween 留 C++ 批量快路径，
与 Timeline 共用 easing/keyframe/反射写入。** 这样可消掉一整个 codegen 子系统、一套 C++ 系统、poll 缓冲、
脑裂同步，同时为编辑器换来 **scrub == evaluate-at-T 免费** 的实时预览。

---

## 1. 现状病灶（file:line）

### G1：可动画目标硬编码成枚举 + 大 switch（根因）
- `src/esengine/animation/animTargets.generated.hpp` —— `enum AnimTargetField`（`TransformPositionX`…）+
  `applyAnimatedValue()` 一个 ~40 路 `switch`，逐字段直接写结构体成员；末路 `CustomField` 空 case（TS 兜底）。
- `src/esengine/animation/animTargets.generated.ts` —— `FIELD_MAP: Record<component, Record<path, enum>>` 镜像。
- 生成器 `tools/eht/generators/anim_target.py` —— **与** `metadata.py`（`COMPONENT_META.animatableFields`）/
  `ptr_layout.py`（`PTR_LAYOUTS`）**同源**于 `ES_PROPERTY(animatable)`。即：可动画字段已有引擎权威表，枚举是第二套真源。
- **逐字段语义不可省**：`rotation.z` 欧拉角→四元数 `glm::quat(cos h,0,0,sin h)`、UIRect `anim_override_` 标志等——
  重构不是"删 switch"，是"把 switch 改成数据驱动的 `path → writer` 反射表"，逐字段语义保留为表项。

### G2：每种轨道一个 binding（刚性）
- `src/esengine/bindings/TimelineBindings.cpp` —— `tl_addPropertyTrack` / `tl_addSpineTrack` / `tl_addAudioTrack` /
  `tl_addActivationTrack` / `tl_addSpriteAnimTrack` / `tl_addCustomPropertyTrack`，各自手工 float 打包。
  每加一种轨道都要动 C++ binding + `TimelineUploader.ts` 分支。

### G3：脑裂 + 每帧轮询结果缓冲
- C++ 持运行时 timeline（`TimelineSystem.cpp` / `TimelineData.hpp`），TS 持文档（`TimelineTypes.ts`），
  靠 `TimelineUploader.ts` re-upload 同步——两份真源。
- side-effect 走"结果缓冲轮询"：`TimelineBindings.cpp` `tl_getEventCount/getEventType/...` +
  `tl_getCustomPropertyCount/...`，TS 端 `TimelineRuntime.ts` `processTimelineEvents()` / `processCustomProperties()`
  每帧循环跨 WASM 边界拉取再 `tl_clearResults()`。（同款 poll 模式 spine 也有，是 WASM 边界产物，非通用范式。）

### G4：没有 scrub 原语、没有创作/序列化
- `TimelineSystem.cpp:388` `evaluateAt()` 只回**裸通道值不应用**；`advance()`（:362）应用但只能按 dt **前进**——
  编辑器拖播放头没有"在任意 T 采样并应用"的干净入口。
- 全栈**没有任何创作 API**（add/remove track、add/move/setInterp keyframe），**没有序列化器**
  （`TimelineLoader.ts` 只解析 `.estimeline`，无逆向写盘）；`Marker`/`CustomEvent` 是只声明不实现的空桩。

### G5：4 份重复 easing + 两套 keyframe 类型
- `src/esengine/animation/EasingFunctions.hpp`（全集，仅 Tween 用）、`TimelineSystem.cpp:114-124`（内联重复 3 个）、
  `src/esengine/particle/ParticleEasing.hpp`（子集）、`sdk/src/camera/CameraDirector.ts` `applyCurve()`（第三套）。
- TS 侧 `sdk/src/animation/Easing.ts` 已是 C++ 全集的 1:1 端口（可直接当统一 TS 源）。
- Timeline 有带切线的 `TimelineKeyframe`（最富），Tween 只有隐式 from/to+easing——无统一 `Keyframe`。

### G6：编辑器完全没有动画面板
- `desktop/src/panels/` 只有 Outliner/Viewport/Details/ContentBrowser/OutputLog/GamePanel；
  `DockLayout.tsx` 组件表无 sequencer；设计稿底部停靠 tab「动画 Sequencer」缺席。

---

## 2. 目标架构（四层）

每层都**复用**引擎/编辑器已有的权威机制，而非再造。

### L1 —— 统一反射写入层（codegen，C++ + TS 双镜像）
- 由 `ES_PROPERTY(animatable)` 生成一张**数据驱动写入表** `path → writer`，取代 `AnimTargetField` 枚举 + switch + `FIELD_MAP`。
  - C++：`ComponentFieldRegistry`（typeId → {name, offset, type, applyFn}），`applyFn` 承载逐字段语义（quat 转换、override 标志）。
  - TS：复用既有 `PTR_LAYOUTS` + `writePtrField`，特例字段配套 writer（mirror C++ applyFn）。
- **唯一写入路径**：Tween（C++）、Timeline（TS）、编辑器预览全部经此，与 Inspector/序列化同源。
- 产出：删 `animTargets.generated.{hpp,ts}` 的枚举/switch/FIELD_MAP，改为生成 registry/表。

### L2 —— 统一 easing / keyframe 数学
- C++ `SharedEasing.hpp`（由 `EasingFunctions.hpp` 提升）+ TS `Easing.ts`（已存在端口）；删 Timeline 内联、Particle 子集、Camera 第三套（改为委托/共享）。
- 单一 `Keyframe { time, value, interp, inTangent, outTangent }` + `evaluateChannel(channel, t)`；Hermite/Linear/Step/Ease* 各模式集中一处。

### L3 —— Timeline 运行时：纯 TS（文档即运行时）
- `TimelineEvaluator.sample(doc, t, ctx)`：求值属性通道→走 L1 写入；side-effect（audio/spine/spriteAnim/activation/event）
  在 TS 内**边沿检测**（prevT→t）直接调对应 JS 子系统（`audio.playSFX` / `SpineManager.setAnimation` / SpriteAnimator / world.set）。
- forward play 与 scrub **同一入口**（play = 累加 t 后 sample；scrub = 任意 T 直接 sample）→ scrub 免费。
- 删 C++ `TimelineSystem`/`TimelineData`、`tl_add*Track`、poll 缓冲；`TimelinePlugin` 改为驱动 TS evaluator。
- **Tween 留 C++** 批量快路径，apply 改走 L1 的 C++ registry。

### L4 —— 创作层 + Sequencer 面板（编辑器，全新）
- **资产文档会话**（首个，镜像 `EditorSession`/`SceneModel`/`Reconciler`/`SceneCommands`/`SceneStore`/`SceneQuery`/`EditorHistory`）：
  - `TimelineDocument`（= `.estimeline` JSON，**也就是 L3 的运行时对象**，无独立 upload）。
  - `TimelineCommands`（addTrack/removeTrack/mute/addKey/moveKey/deleteKey/setValue/setInterp/setDuration/setFps/setWrap），
    每步经**同一** `EditorHistory`/`TransactionManager` 可撤销。
  - 响应式 `TimelineStore` + `TimelineQuery` + `TimelineSerializer`（`TimelineLoader` 的逆）。
  - 抽成 `AssetDocumentSession<T>` 基类——瓦片集/瓦片地图编辑器后续复用。
- **`Sequencer.tsx`**：底部停靠 tab（与 Content/Log 并排，`referencePanel:'content', direction:'within'`）+ ActivityBar 入口 +
  `editorStore` sequencer 态（当前 clip、播放头 time/frame、选中关键帧、录制）。
  传输条 / 轨道树（实体→组件→属性）/ 时间轴（标尺·帧网格·可拖播放头·关键帧道）/ 摄影表⇄曲线 / 精灵帧条 / 插值弹窗 / 吸附帧 / 录制（自动打帧）。
  复用 Details 的 scrub 手势 + 色板 token；"添加轨道"选择器由 `COMPONENT_META.animatableFields` + 选中实体层级（childPath）驱动。
- **实时预览**：拖播放头/改关键帧 → 在播放头处 `evaluator.sample` 应用到绑定实体 → 视口即刷（scrub 免费的兑现点）。

### 资产格式说明
- **`.estimeline`** = 多轨 Sequencer 文档（property/spine/audio/activation/spriteAnim 轨 + Hermite/Linear/Step/Ease*）——本次 Sequencer 的编辑对象。
- **`.esanim`**（AnimClip 精灵翻页，`AnimClipLoader.ts`）保持独立，作为 Sequencer 底部「精灵帧条」/ SpriteAnim 轨的来源。
- 设计稿把 clip 写成 `Walk.esanim` 是 mockup 笔误；落地以 `.estimeline` 为 Sequencer 文档格式（沿用 loader version "1.1"）。

---

## 3. 分阶段计划（编辑器优先）

> 每阶段可独立验证、可单独提交。P1–P3 让编辑器先跑起来（建在最小新 TS runtime 上），P4 回收 C++ 临时实现，P5 收尾通用化。

- **P1 —— 端到端可见闭环（证明 seam）**
  L3 最小核（仅属性轨）`TimelineEvaluator.sample` + L4 文档会话骨架 + `TimelineSerializer`（读已有 + 写）。
  `Sequencer.tsx` 注册进底部停靠 + ActivityBar + store；开 `.estimeline`（Content Browser 双击 / 选中实体的 TimelinePlayer）→ 渲染轨道树 + 关键帧道 + 播放头；
  拖播放头 → `sample` 应用到绑定实体 → 视口实时动。**验收：开真实 `.estimeline` → 见轨道 → 拖播放头角色动起来。**

- **P2 —— 编辑 + 撤销 + 存盘**
  `TimelineCommands`（add/move/delete key、setValue、setInterp）经 `EditorHistory` 手势；关键帧拖拽（时间+值）、插值弹窗、吸附帧；
  存盘走 Electron fs（`ProjectStore`）；录制态（auto-key：录制中改 Inspector 受跟踪属性 → 在播放头插帧）。**验收：打帧/拖帧/改插值/撤销重做/存盘往返。**

- **P3 —— 轨道创作 + 传输 + 曲线视图**
  添加轨道选择器（`COMPONENT_META.animatableFields` + 实体层级 childPath）；静音/独奏、duration/fps/wrap 编辑、分组折叠；
  曲线视图（hermite/bezier 手柄）+ 摄影表⇄曲线切换；编辑态播放循环（rAF 驱动 sample）+ 上/下关键帧 + loop；精灵帧条（AnimFrames / SpriteAnimator）。

- **P4 —— 回收 C++ 临时实现（引擎重构落地）**
  side-effect 派发全部并入 TS evaluator（边沿检测）→ 删 C++ `TimelineSystem`/`TimelineData`/`TimelineBindings`（`tl_*`）+ poll 缓冲；
  生成 L1 反射写入表（C+++TS）→ 删 `animTargets` 枚举/switch/FIELD_MAP，Tween 的 C++ apply 改走新 registry；合并 easing（4→1）。
  **预期 `esengine.wasm` 体积下降**（同 spine 重构 -503KB 的量级方向）。**验收：全测试绿 + wasm 重建 + 体积对比。**

- **P5 —— 通用化收尾（可选）**
  抽 `AssetDocumentSession<T>` 基类；为 Animator/状态机层（设计稿 `Animator` 组件）预留组合点；瓦片集/瓦片地图编辑器复用同基类。

---

## 4. 风险 / 注记
- **堆布局特例**：`writePtrField` 写的是 C++ 堆布局，少数字段 JS 形状与堆布局背离（如 Camera `viewport` vec4 vs JS viewportX/Y/W/H）。
  L1 生成器同时知道偏移与打包，特例配套 writer；不可对所有字段裸 poke。
- **rotation.z 语义**：JS Transform 用四元数；动画"rotation.z"按欧拉角需转换——L1 writer 表项承担，TS/C++ 两侧对齐。
- **确定性**：play-realm 本就跑 SDK（TS）；TS 定步求值与原 C++ 数值一致即可，无新确定性风险。
- **P4 之前**：P1–P3 期间 C++ 旧 timeline 与新 TS evaluator **并存**（编辑器走新核，运行时旧核暂留），P4 才删旧核，避免中途破坏现有运行时播放。
</content>
</invoke>
