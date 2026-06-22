# REARCH_GUI：运行时 GUI clean-sheet 重写（ECS 原生现代框架）

> 对象是**运行时 GUI 系统** `sdk/src/ui`(~54 TS 文件 ~7k LOC,TS side-module 覆于 C++ wasm 引擎之上),**不是**编辑器(那是 `desktop/`,见 `REARCH_EDITOR_*`)。
>
> **定位变更(2026-06-22)**:作者本人确认该 GUI 是早期**临时**实现,允许**推倒重写**。因此本文从"小心缝合两代、像素一致增量"改为 **clean-sheet 重写**:沿用引擎已是 SOTA 的底座(ECS + Yoga + 序列化 + 编辑器 + 渲染管线),把 TS 逻辑层**重建为一套统一的现代 UI 框架**,补齐缺失的现代层(MSDF 文本 / 样式系统 / 响应式绑定 / 正经事件传播 / 声明式组合 / 动画整合),最后**删除全部遗留 plugin**。
>
> **对象模型决策:A — ECS 原生**(已定)。UI = 实体 + 组件。否决 B(并行 VisualElement 树 / UI-Toolkit 式)与 C(渐进改造)。理由见 §1.5。

---

## 0. 横切约束（决定排序，不可绕过）

与 `REARCH_RENDER.md` 同一主战场:**微信小游戏 + playable**,WebGL2 一等公民,**无 DOM 保证**(WeChat 无 DOM)。由此:

- **DOM 依赖须可回退**:遗留 `TextInputPlugin` 用隐藏 `<textarea>`(`TextInputPlugin.ts:66`),`TextRenderer` 用 `platformCreateCanvas`。重写后文本/输入走 platform 抽象,不得硬依赖浏览器 DOM。
- **C++ 管热循环、TS 管策略**:布局(Yoga)、命中测试、渲染排序、UIRenderer→draw collect、字形图集 在 C++;TS 负责样式解析、事件分发、行为 FSM、虚拟化、绑定、声明式组合。
- **接 render-rearch**:UI 渲染并入 `REARCH_RENDER` 的 `DrawList`/批次/PipelineState,**不再每文本实体一张 Canvas2D 纹理**。
- **接 animation-rearch**:UI 过渡/状态动画走 `REARCH_ANIMATION` 的统一缓动/求值器,不自造 lerp。
- **重写 ≠ 全停摆**:strangler-fig 迁移——新模块与遗留并存,逐层把 examples/widgets 切到新模块,达成 parity 后再删遗留。公共 barrel `index.ts` 在可行处保持稳定,破坏性变更集中在一次。

---

## 1. 现状评估

### 1.1 底座:沿用（已是对的，重写不碰）
| 子系统 | 状态 | 证据 |
|---|---|---|
| 作者化模型 | ✅ 正解 | UI = 实体 + builtin 组件,随 `.esscene`/prefab 序列化(`scene.ts`/`sceneManager.ts`);编辑器直接当实体编辑。无需单独 UI 文档格式 |
| 布局求解器 | ✅ SOTA | C++ `ecs/UILayoutSystem.cpp` 直接用 **Yoga**(`toYGFlexDirection`/`YGJustify*`,`:130-157`),flex/wrap/justify/align/anchor 单趟 `uiLayout_update`。与 Unity UI Toolkit/RN 同款 |
| ECS 组件存储 | ✅ | builtin 组件存于 C++ registry,经 codegen 镜像到 TS;reset-proof、可序列化 |
| 渲染收集 | ✅ 可接 | UIRenderer→draw 在 C++ `renderer/plugins/UIElementPlugin.cpp`;并入 render-rearch DrawList 即可 |

### 1.2 可借鉴的好点子（重写时在干净模型里重建，而非原样保留）
- 虚拟化:`collection/`(ListView+ViewPool+LayoutProvider+DataSource)——思路对(实体池回收 + 可见区间裁剪 + 变更通知),重建进统一模型。
- 事件总线:`core/events.ts`(实体级+全局订阅、冒泡、再入保护)——重写为正经 capture→target→bubble 传播引擎。

### 1.3 病灶（为什么重写而非修补）
1. **两代架构并存 / 职责劈两半**:组件 schema 在 `core/`/`layout/`/`behavior/`,驱动它们的 system 却在 ~11 个遗留扁平 plugin(`UIInteractionPlugin`/`DragPlugin`/`FocusPlugin`/`ImagePlugin`/`TextPlugin`/`TextInputPlugin`/`ScrollViewPlugin`/`SafeAreaPlugin`/`UIRenderOrderPlugin`/`UIMaskPlugin`/`UILayoutPlugin`);新 `behavior/systems.ts` 又叠一层。`index.ts:269` 起整段 `// Legacy plugins / resources still in ui/` 自供状。
2. **~13 个 plugin 手写排序**:`uiPlugins.ts` 12 项 + `systemLabels.ts` 字符串常量 + 各处 `runAfter`/`runBefore` 拼出隐式管线,无单一事实源。
3. **滚动双实现**:遗留 `ScrollView`(Transform + 惯性/弹性物理)vs 新 `collection/scroll-container`(纯状态)。
4. **文本双实现 + 最不先进**:C++ `BitmapText`+`text/BitmapFont.cpp`(.fnt 图集、批渲染、快,但位图字体)vs TS `Text`+`TextRenderer.ts`(Canvas2D 整串栅格化→**每实体一张 GPU 纹理**→慢、无 SDF;富文本/系统字体)。UI 主用慢路径;`TextInputPlugin` 又复制一套。
5. **缺响应式绑定**(全命令式 `setValue`)、**主题未整合**(`UITheme` 孤立 resource,widget 收裸 color)、**动画自造轮子**(`StateVisualsApplySystem` 私有颜色/缩放 lerp)。

### 1.4 C++ 侧体量
`ecs/UILayoutSystem.cpp`(434,Yoga)· `text/BitmapFont.cpp`(242)· `renderer/plugins/TextPlugin.cpp`(164)· `renderer/plugins/UIElementPlugin.cpp`(121)· `ecs/UISystem.cpp`(64)。C++ 已拥有 ECS 存储 + Yoga 布局 + 命中测试 + 渲染排序 + UIRenderer draw collect + 位图字形图集基建。

### 1.5 对象模型决策：A（ECS 原生）
| | A. ECS 原生(选定) | B. 并行保留树(UI Toolkit 式) | C. 渐进改造 |
|---|---|---|---|
| 元素 | 实体 + 组件 | 独立 VisualElement 树 + USS/UXML | 维持 |
| 布局 | 复用 C++ Yoga | 自带(也 Yoga) | 现状 |
| 序列化/编辑器 | **白嫖** | 另造 UI 文档 + 编辑器集成 | 现状 |
| 渲染 | 接 render-rearch DrawList | 自渲染再桥接 | 现状 |
| 工量 | 重写 TS 逻辑层 | 造平行对象模型(最大) | 最小但不够先进 |

**选 A**:引擎从底到顶 ECS,作者化已是"UI=实体进场景",Yoga 已绑 ECS 组件,编辑器已能编辑实体。Bevy 即 A。Unity 另搞 UI Toolkit(B)是为治其 GameObject-per-element 旧债 + 编辑器特殊需求——我们**无此历史包袱**,A 能白嫖全部引擎投资,B 要把序列化/编辑器/布局重造。A 的短板(组合啰嗦/无绑定/无样式)用加层补齐,无须换对象模型。

---

## 2. 目标架构（clean-sheet）

### 2.1 原则
**一套 ECS 原生保留模式 UI 框架:每个关注点一个负责人(schema 与其 system 同模块),整套一条显式有序管线(单个 `UIPlugin`),C++ 管热循环、TS 管策略,渲染接 render-rearch、动画接 animation-rearch。**

### 2.2 统一组件集（一套到底，消灭 legacy/new 双轨）
| 组件 | 角色 | 取代 |
|---|---|---|
| `UINode` | 布局盒:锚点/偏移/尺寸/pivot(输入)+ 计算矩形(Yoga 输出) | UIRect |
| `Flex` / `FlexItem` / `Grid` | 布局意图(Yoga 解算) | FlexContainer/FlexItem/GridLayout(清理重命名) |
| `UIStyle` | 解析后的视觉样式:背景色/图、边框、圆角、不透明度、tint(由样式系统驱动) | 散落各 widget 的裸色 + 孤立 UITheme |
| `UIImage` | sprite / nine-slice / tiled / filled | Image |
| `UIText` | 文本内容 + 字体/字号/样式引用 → MSDF 字形 run | **BitmapText + Text 两者** |
| `UIRenderer` | 低层 draw 组件(由 UIStyle/UIImage/UIText 计算,C++ 渲染读取) | UIRenderer(收敛为计算产物) |
| `Interactable` / `UIInteraction` | 命中门控(配置)/ 帧状态(计算) | 同名,清理 |
| `Focusable` / `Draggable` | 焦点 / 拖拽配置 | 同名 |
| `StateMachine` / `StateVisuals` | FSM 状态 / 状态→视觉(过渡走动画运行时) | 同名,去私有 lerp |

### 2.3 模块结构（schema 与 system 同处，单一负责人）
```
sdk/src/ui/
  core/        UINode · UIStyle · 事件传播引擎 · UIPlugin(单管线装配)
  layout/      Flex/Grid + 唯一 Yoga 驱动 system + SafeArea
  text/        UIText + MSDF 字形图集 + 富文本布局(复用 RichText 解析)
  render/      UIImage · UIRenderer 构建 · 渲染排序 · DrawList 接入
  input/       Interactable/UIInteraction + 命中测试 + 事件分发 + Focusable + Draggable + 其 system
  behavior/    StateMachine/StateVisuals + FSM system(动画整合) + widget 驱动
  style/       stylesheet/主题 token + 级联解析器
  binding/     响应式 observable→字段
  collection/  虚拟化(ListView/ViewPool)+ 唯一 ScrollView(并入遗留物理)
  widgets/     声明式 widget builder
  index.ts     公共 barrel
```

### 2.4 单管线（一个 UIPlugin，固定有序）
```
PreUpdate :  SafeArea → StyleResolve → Layout(Yoga) → HitTest
Update    :  EventDispatch(capture→target→bubble) → Behavior(FSM/Drag/Focus)
             → BindingApply → Content(UIText/UIImage 构建)
PostUpdate:  ScrollView → RenderOrder → Render(DrawList)
```
排序在 `UIPlugin` 内单处定义,替代 12 plugin 各自的 `runAfter`/`runBefore` + `systemLabels` 散落常量。

### 2.5 现代层（干净新建）
1. **MSDF 字形图集文本(头号 keystone)**:单一 SDF 路径——C++ 管图集(离线/运行时 MSDF 生成)+ 批量字形 quad(并入 render-rearch DrawList,与 sprite 同批);TS 管富文本解析/布局喂字形序列。**任意缩放清晰、字形级批合并(告别每实体一纹理)、系统字体+富文本+emoji 统一**,一举退役 `BitmapText`-only 与 Canvas2D-每实体两条路。`TextInput` 复用同一渲染路径,只加光标/选区/IME。
2. **样式系统(USS 式级联 token)**:stylesheet/主题资产 → 解析为 `UIStyle`(级联 + 状态变体)。widget 与作者化 UI 读主题,取代裸色 + 孤立 UITheme。
3. **响应式绑定**:observable/signal → 组件字段。声明式数据驱动,删命令式 `setValue` 样板。
4. **事件传播引擎**:capture→target→bubble 三相,单一引擎(替代现"发射者手动走父链")。
5. **声明式组合 API**:builder/JSX 式描述 UI,内部 spawn 实体树。DX 对标 UI Toolkit,但产物是 ECS 实体(保住序列化/编辑器)。
6. **动画整合**:状态过渡/transition 委托 animation-rearch 运行时。

---

## 3. 分阶段落地（rewrite 序：建新 → 迁移 → 删遗留）

| 阶段 | 内容 | 产出/判据 |
|---|---|---|
| **P0 骨架** | 锁定 §2.2 组件集 + §2.3 模块结构 + 单 `UIPlugin` 管线;新 system 初期可 wrap/port 现逻辑保持可跑。遗留隔离待删 | 新框架骨架立起,UI 测试套件仍绿 |
| **P1 文本 keystone** | 单一 MSDF 字形图集路径,退役 BitmapText + Canvas2D-每实体,接 render-rearch 批次 | 清晰度↑、draw call↓、富文本/系统字体统一 |
| **P2 样式/主题** | USS 式级联 token + 主题资产,UIStyle 解析,widget 读主题 | 去裸色,主题可切换 |
| **P3 绑定 + 组合** | 响应式 observable→字段;声明式 widget builder | 删 setValue 样板,组合不再手 spawn |
| **P4 移植 + 删遗留** | widget 移植到新模型、examples 迁移、**删除全部遗留 plugin**(UIInteraction/Drag/Focus/Image/Text/TextInput/ScrollView/SafeArea/UIRenderOrder/UIMask + ScrollView.ts/TextInput.ts/SafeArea.ts/TextRenderer 旧路径) | `index.ts` 单一现代 barrel,无 legacy 段 |
| **P5 动画整合** | StateVisuals/过渡委托 animation-rearch | 去私有 lerp |

> P1(文本)是最大单点收益,可在 P0 骨架后优先并行推进。

---

## 4. 迁移与删除（strangler-fig）

- 新模块在 `sdk/src/ui/` 内逐层立起,与遗留并存;`uiPlugins.ts` 渐次把遗留 plugin 换成新 `UIPlugin` 的子系统。
- 每层达成 parity(对应 UI 测试 + examples 跑通)后删对应遗留文件。
- 破坏性公共 API 变更集中到 P4 一次,`index.ts` 收敛为单一现代 barrel。
- C++ 侧:Yoga 布局/命中/排序保留;新增 MSDF 图集(P1)替代 BitmapFont-only;`UIElementPlugin.cpp` 渲染并入 render-rearch DrawList。

---

## 5. 验证基建

- **回归护栏**:现有 ~25 个 UI 测试(`sdk/tests/ui-*.test.ts`,含 `ui-plugins`/`ui-systems`/`ui-behavior`/`scrollview`/`ui-components`/`uiLayout`/`RichText*` 等)。重写保持行为处,测试须持续绿;契约变更处同步更新测试。
- **像素验证**:补 UI headless fixture,逐帧 diff(对齐 render-rearch 的 `verify:render:*` 范式)。P1 文本重点测同字号/缩放清晰度 + draw call 数(字形批合并应显著降 draw call,类比 RC7-2 sprite 4→3)。
- **对外回归基线**:`examples/ui-layout|ui-interaction|ui-controls` 三例。

---

---

## 7. P1 详细落地：统一动态 SDF 字形图集文本（微信+web+CJK）

### 7.1 约束反推的决策
主战场微信=中文受众 → **海量动态 CJK 文本**(玩家名/聊天/描述,数千字形)。由此:
- **运行时动态字形图集**(不是离线 MSDF 全集):CJK 全集 MSDF 纹理爆炸,不可行。按需用 **Canvas2D 栅格化**任意字形(web 与微信都可用且**现有 TS 文本路径已在用 `getImageData`→`createTexture` 且微信能跑**,已去风险),打包进共享图集 + 缓存。覆盖任意字体 + CJK + emoji。
- **从栅格 alpha 生成单通道 SDF**(可行的"MSDF 级"方案):真 MSDF 需矢量轮廓(opentype 解析,运行时 CJK 不现实)。改用 **C++/WASM 距离变换(8SSEDT)** 从 Canvas2D 的 alpha 算 SDF → 任意缩放清晰;SDF 还**廉价+清晰地给描边/阴影/发光**(比现 Canvas2D 更好,顺带覆盖 UI Text 的 stroke/shadow)。(可选未来:Latin 离线真 MSDF。)
- **复用 C++ 批量字形 quad 路径**(`TextPlugin.collect`→`emitQuad`→`DrawList`)+ RC7-6 shader 变体系统加 **SDF 变体**(`batch.esshader` `#pragma feature SDF`)。不新建管线。
- 简单文本走 C++ 布局(现有 `TextPlugin` UTF-8+kerning+align),富文本走 TS(复用 `RichTextLayout`,后置子阶段)。

### 7.2 新增基元
1. **`Texture::updateSubRegion`**(C++)+ binding + TS `ResourceManager.updateTextureSubregion` —— 子区域上传单字形(`GfxDevice.texSubImage2D` 已支持,Texture 仅缺封装)。
2. **C++ SDF 距离变换**(8SSEDT):`sdfFromAlpha(alpha,w,h,range)→u8` binding;TS 传栅格 alpha 取 SDF。
3. **TS `GlyphAtlas` 管理器**:shelf/skyline 装箱 + 字形缓存(键=font/size-bucket/codepoint/style);miss→Canvas2D 栅格→C++ SDF→装箱→子上传→把字形 metrics 注册进 C++ DynamicFont。
4. **C++ `DynamicFont`**:把 `BitmapFont` 泛化为运行时可加字形(id,x,y,w,h,offsets,advance)+ isSDF + pxRange。

### 7.3 管线接入（决策:TS 中心,方案 B —— 实现期定）
两种接法:**A C++ 中心**(C++ TextPlugin 读组件 + DynamicFont,需逐字形 binding + 在 C++/TS 两处重复 metrics);**B TS 中心**(TS 已有 GlyphAtlas 持全 metrics → TS 布局 + 生成字形 quad → 经一个通用 `submitTextBatch` 提交,C++ 只批渲染)。**选 B**:复用已验证的 spine TS-提交模式、单一 metrics 事实源(DRY)、无 DynamicFont/无逐字形 binding、富文本天然在 TS。
- C++ `RenderFrame::submitTextBatch`(仿 `submitSpineBatch`,但走 `batchProgram({"SDF"})` + RenderType::Text;非门控)+ `renderer_submitTextBatch` binding + TS `ui/text/submit.ts`(HEAPU8 字节拷贝,因该 wasm 仅导出 HEAPU8)。
- TS **文本系统**(pre-flush 回调):扫可见文本实体 → glyph-prepare(GlyphAtlas 备字形,限量/帧)→ 布局 → 生成 quad → `submitTextBatch`。

### 7.4 组件统一
- **`UIText`**(并 BitmapText + `core/text.ts` Text):text/font/fontSize/color/align/wrap + outlineColor/Width + shadowColor/Offset/Blur + richText(flag)。替换两者。

### 7.5 子阶段（每步 build wasm + 验证）
- **P1.0** 图集子区域基元(`Texture::updateSubRegion` + binding + TS 封装)。
- **P1.1** GlyphAtlas 管理器 + SDF 生成(C++ 8SSEDT binding + TS 栅格/装箱/缓存)。
- **P1.2** SDF shader 变体(median/smoothstep + pxRange + outline/shadow uniforms)。
- **P1.3** TS 中心(方案 B):①`submitTextBatch` 提交基元(C+++binding+TS,DONE)→ ②真 `CanvasGlyphRasterizer`+`EngineAtlasPageStore` 接 GlyphAtlas → ③ TS 文本系统(pre-flush:glyph-prepare+布局+生成 quad+提交)→ 端到端清晰批量 CJK 文本;headless 渲染验 draw call↓ + 清晰度。
- **P1.4** 富文本(TS 布局 runs)+ SDF 描边/阴影;`core/text.ts` Text→`UIText`;退役 Canvas2D-每实体路径。
- **P1.5** TextInput 接新路径(光标/选区/IME overlay)。
- **P1.6** 退役 BitmapText(debug overlay 迁移或保留);shim 统一 P4 删。

### 7.6 微信保险
- getImageData 复用现成路径,但**真机 WeChat build 验证后**再依赖;SDF 太重时回退**纯 alpha 图集**(仍批渲染)。图集页预算 1024²/2048²,溢出多页;CJK 工作集(可见字形)而非全集。

构建:`node build-tools/cli.js build -t web`(按 hpp/cpp/h/esshader 源 hash 缓存,增量较快)。emcc 5.0.6 在 `~/.emsdk`。

---

> 状态(2026-06-22):方向 **A(ECS 原生 clean rewrite)**。**P0 纯重定位完成**(layout/input/render 概念模块化 + shim,全套 2268 测试绿)。**P1 开工**:统一动态 SDF 字形图集文本,从 P1.0(图集子区域基元)起。记忆见 `gui-rearch.md`。
