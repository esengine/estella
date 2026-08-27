# Estella Roadmap

> 状态基线：0.58.0（2026-08-27）。这份文件只写**从 CHANGELOG 和提交信息里读不出来的东西**：
> 下一步做什么、为什么是它、以及「做完了」长什么样。逐条改了什么在 CHANGELOG 里。
>
> `docs/REARCH_*.md` 是 gitignore 的，活不过一次 clone；这份是 tracked 的，所以放在这里。

## 现在站在哪

- **AOT 三条路都通了**：web、小游戏、桌面 native。桌面打包的游戏把标了 `@compiled` 的
  系统当机器码跑，`bench/aot-native/frame-bench.mjs --gate` 让它成为发布准则。
- **无 JIT 的帧第一次被量到**：5,000 实体、一个做三次乘加的系统，**51 ms 解释 → 1.7 ms 编译**，
  解释器代价在真实帧上是 **61x**（不是裸循环的 154–385x）。
- **3D 地基收口**：render graph 拥有 scene pass、depth 可采样、`render.meshes/triangles/culled`
  有计数、三条 `*-scale-cost` 有天花板。
- **`examples/celestial-heights/engine-gaps.mjs` 是空的** —— 旗舰游戏没有一处在绕开引擎。
- **子系统定级**：28 个里 6 个 `public`、10 个 `beta`、12 个 `experimental`。

## 1. 编译系统的代价正比于「世界」，不是「它匹配的集合」（前半已落地）

**证据。** `native/host/bindings/AotBindings.cpp` 里，每帧、每个编译系统，`es_aot_run`
用 `forEachEntity` 把**所有活实体**推进候选表，`aot::run` 再对每一个解析每个组件。
量到的：同样 5,000 个 mover，世界 5,000 时 0.114 ms，世界 50,000 时 0.333 ms —— **2.9x**，
约 4.9 ns/帧/它根本不碰的实体。解释侧是对照组，几乎不动（49.3 → 51.2 ms），因为 SDK 的
query 会收窄。20k 实体、一个匹配 200 的系统 → 96% 的工作是空转，第二个编译系统再扫一遍。

**为什么它排第一。** 这是唯一一处「编译这条路在某个维度上比解释还差」的地方，而且它随
游戏变大而变糟 —— 正好是 AOT 存在的场景。两处修都不是编译器改动，都在同一个进程里。

**两条 AOT 路要回答的是同一组问题，而 native 这条一个也没答。** `AotDispatch.ts`
（web）的文件头把模型写死了：**一张 row table 是两件事的函数 —— 哪些实体匹配，以及它们的
组件在哪。** 每一件都有一个已经能便宜回答的权威。web 那条路两个都用上了（query cache 的
数组身份 + `World.layoutEpoch`），native 那条路两个都没用 —— 它每帧重扫世界、重打全表。
所以这不是给 native 加一个优化，是把它补齐到 web 已有的那个形状。

**做什么。**

1. **哪些实体匹配 —— 用最短的那一列收窄候选。**〔已落地〕`AotHost::run` 的注释一直写着
   「caller passes the smallest pool it has」，而 native 这个 caller 从来没做到。
   `Registry::entitiesWith<T>()` 把 `View` 内部一直在用的「取最小池」这件事开成一扇门
   （`View` 拿的是类型，AOT 宿主拿的是名字，所以必须在运行期问）；发
   `AotComponents.generated.*` 的那个 generator 顺手发出第二张表。
   script 组件那半需要池自己的 dense 面 —— `ScriptPool` 的 slot 是复用不压缩的，所以
   slot→entity 的表天然就是它，代价是每次 put/delete 一次 O(1) 写。**这一半是必须的**：
   bench 里的 `Mover` 是项目组件，只收窄引擎池什么也买不到。

2. **组件在哪 —— 跨帧复用 row table。**〔待做〕web 那条路量到 27.5 → 不到 2 ns/entity。
   native 侧更值：已经量到「代价不是代码」（thin 20 ns、heavy 21 ns，四次 substep 和四次
   sqrt 与三次乘加同价），也就是说编译系统的代价**几乎全是打表**。

   **开工前必须知道的一件事，否则会写出一个静默错误的缓存。**
   `Registry::layoutEpoch()` 是「地址有没有动」的权威，**不是「谁匹配」的权威** ——
   `SparseSet::emplace` 只在 `components_` 真的 realloc 时才 `++version_`（容量内追加不
   动已发出的指针，所以不需要 bump）。也就是说**往池里加一个实体可以完全不动 epoch**。
   web 那条路正是因此用了**两个**条件，不是一个。native 侧的对应物：
   - 「谁匹配」= 收窄后那一列的 `(data(), size())` 身份。引擎侧够用：容量内 emplace 会让
     `size()` 变，realloc 会让 `data()` 变或让 epoch 变，`remove`/`clear`/`sort` 无条件
     bump epoch。
   - **script 列不够用。** 删一个 slot 不改 `rows`/`sparse`/`ownerCount`（`next_` 不回退），
     只在 owners 数组里留一个洞 —— 宿主看到的 span 逐字节同一个。所以 script 那半需要
     `ScriptStorage.layoutEpoch` 真的过界，World 上要开一扇 `scriptLayoutEpoch()`，
     `es_aot_run` 要多收一个参数。
   - 引擎侧的 epoch **不需要**过界：native 宿主就在同一个进程里，直接
     `host().registry->layoutEpoch()`（web 那条路当年还得为此加 embind 绑定）。

   **先做 1 再量 2**，因为 1 做完之后 2 的分母变了。

**前半的结果（`8379ba9f3`，2026-08-27）。** 同机实测：20,000 个 mover 在
200,000 实体的世界里，系统自身代价 **0.43 ms**，与「世界里只有它自己」的 0.51 ms 无异；
收窄前是 1.29 ms。

**门禁不是时钟，是计数。** 原计划是「小世界/大世界的每实体代价比值」，实测行不通：
idle 相减的 run-to-run 抖动是 ±0.3 ms，而答案本身只有 0.4 ms —— 同一个构建的小世界测了
0.226 ms，重测得 −0.015 ms。修好与修坏在 200,000 实体世界里是 1.45 ms vs 2.31 ms，
1.6x，噪声够得着。所以宿主改为发布一个**计数** `aotCandidates`（`native/host/Bench.hpp`），
`frame-bench --gate` 断言 `walked <= ENTITIES * 1.5`：20,000 对 200,001，精确、无容差。
双向 sabotage 验过。**先找那个计数器，再去找更好的时钟。**

顺带修掉一个它翻出来的 bug：`installNativeAot` 把实体索引掩码自己拼成了 20 位（真值 22 位），
世界超过 2^20 实体时一个脚本组件会读到**另一个实体的行**。

## 2. AOT 还没到它本来为之而生的平台

**事实。** 拿到 AOT 的是**有 JIT** 的桌面；iOS 和 Android 全解释。这是 2026-08-26
「桌面优先」明确接受的代价（桌面宿主是我们的、能 `dlopen`、导出机就是目标机），但它是
这条路唯一的战略缺口。

**Android 先。** NDK 是个下载，不需要 Apple 硬件；`tools/verify-native-boot.mjs
--platform android` 已经是发布准则，设备那条路已经通了。做的事不是新概念：
`compiler/src/hostCC.ts` 的 seam 从「找宿主编译器」扩成「按 target triple 选编译器」，
`compileTargetFor` 已经是「问宿主要哪条路」的形状，链接标志和模块扩展名那张表也已经在。

**两个已知会咬人的地方**（都是已经付过一次学费的）：MSVC 那次说明「导出什么符号」是每个
平台各自的事（`ES_EXPORT` 要按 NDK 再验一次）；`LoadLibrary` 那次说明「库从哪里找」也是。

**开工前要定的一件事：iOS 的产物形状。** 桌面走 `dlopen` 一个 `.dll`/`.so`。iOS 上模块
要签名并嵌进 app bundle，导出机必须是 Mac。如果最终形状是「导出产出一个 `.a`，宿主重新
链接」，那 `hostCC` 现在就该按**两种产物**设计，而不是等到 iOS 那步再拆已经绿的桌面路。

**完成的样子。** Android 版的 `verify-aot-native`：「N installed」**和**
「\<name\> is running compiled」两个都要，跟桌面同一个准则 —— installed 不够，一个模块
可以加载成功然后永远不被 dispatch 到。

## 3. 一帧花了多少**时间**，没有任何东西给它天花板

**现状。** 计数天花板有（`sprite-scale-cost` / `mesh-scale-cost` / `shadow-scale-cost`）。
时间的没有：`tools/perf-guard.mjs` 断言的是微基准之间的**比值**（CPU 抵消掉），
`tools/perf-budget.mjs` 断言的是 50k 资产工程上**操作**的上限。两个都不看渲染的一帧。

**为什么是现在。** `WebGPUDevice::setPresentUncapped` 刚好为这件事造出来。在它之前，
Fifo 把每一帧量成刷新间隔的整数倍 —— 51 ms 和 1.7 ms 读作「52 ms」和「16.5 ms」，
30x 被量化成 3x。任何时间门禁在那之前都没有意义。

**形状：同机比值，不是毫秒。** 跟 AOT 那个门禁同一个理由 —— 毫秒天花板在别人的机器上
要么松到抓不住东西，要么随机红。

**顺带还欠一个分母**：阴影图集的图块数对光源数。`shadow-scale-cost` 曾经带过
`render.shadow.tiles` 的上限，被拿掉了，因为那个场景里没有任何东西能把它推过 8 ——
它由 cascade 数界定，不由 caster 数界定。要预算它得换一个分母。

## 4. 重读 `rendering` 的判决，顺手解锁 fog / DOF / SSAO

**`rendering` 的 `why` 已经过期一半。** 它写的是「同 AI —— 而且它背后的 render graph
还在动」。后半句不成立了：scene 是声明出来的 pass、target pool 有生命周期、depth 可采样。
唯一没做的（shadow pass 不声明）已经判过「低价值、真风险、别开」。**要么让它毕业，要么把
`why` 改成还成立的那句** —— 一条过期的理由比没有理由更糟，因为它看起来像是被想过的。

**同一批里最便宜的四个。** `tilemap`、`particles`、`mesh`、`i18n` 的 `why` 都是
「有游戏端到端认证了，但还没被拿来定级」。那是一次**读**，不是一次**建**。12 个
experimental 对创作者读起来是「大半个引擎没做完」，哪怕其中几个下面压着两个出货游戏。

**一个便宜且已标好的改动。** `src/esengine/renderer/frame/FrameConstants.hpp` 只有
`viewProjection`（相机位置是从它反解出来的），没有 near/far。fog 和 DOF 要线性深度。
那个头文件自己写着「后面的成员往后追加不需要 std140 padding」。改完之后 SSAO / fog / DOF
就都是普通 shader 活，不是引擎活。

## 5. 两处小的，但正在削弱「清单是真的」

- **`design-frame` 在这台机器上从来没绿过。** HEAD、加它那个提交的父提交、它自己那个提交
  （`1c8dadaac`）全红。它量的是编辑器窗口大小的函数：`ESTELLA_WIN_W/H` 默认 1480x920 红，
  1920x1200 绿。把窗口钉成绿的那个尺寸 = 拿环境去迁就断言。要么把 8% 那个门槛从实际视口
  推出来，要么钉住窗口**并重新标定其它检查**。一个从没绿过的检查不是检查。
- **`tools/releaseGate.mjs` 的 `RELEASE` 还是 `'0.57'`**，而 0.58.0 已经出了。那个文件
  存在的全部理由就是防止清单漂移。

## 明确不做的（省得重新评估）

- **shadow pass 变成声明的 pass。** 它本来要买的东西（可采样 depth、atlas 的生命周期）
  已经到手了 —— 前者根本不需要它，后者靠 `rg::TargetPool` 的 per-frame 出借拿到。剩下的
  是一个声明点加一个 graph 拥有的 atlas，而代价是第二条 draw list + 第二个 transient pool。
  **没有新理由就别开。**
- **本端预测 + 和解、relevancy / 兴趣管理、带宽量化。** RC11 的余项，说好需求驱动。
- **`ai` / `networking` 的定级。** 刻意排在后面：0.50 冻的是「一个游戏由什么构成」，
  建立在其上的层要等下面这些定下来。

## 建议的顺序

**1 → 5 → 4 → 3 → 2。**

先把量到的浪费修掉（1），顺手清掉两处假的清单项（5），再做一次定级重读 + FrameConstants
（4，这两个是「读」和「一个成员」，不是工程），然后是时间门禁（3），最后开 Android（2，
那是以周计的）。
