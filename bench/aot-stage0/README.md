# Stage 0 — 编译系统循环，到底值不值

Stage 0 是这条线的 go/no-go，它要退役的风险是：
**加速可能主要来自边界拷贝，而不是解释器**——而边界拷贝有个只花 5% 成本的 SDK 侧修法（下表的 B）。

一个只报一个数字的 benchmark 分不开这两者。所以这个装置把同一个系统跑四遍：

| 变体 | 是什么 |
|---|---|
| **A** | 今天的 SDK 路径 —— `fillTransform` → 系统体 → `writeTransform` |
| **B** | 就地视图 —— 访问器直接落在组件字节上，不拷进也不回写 |
| **B2** | 裸下标 —— 解释执行的地板，完全没有对象层 |
| **C** | 原生 C++ —— AOT 的天花板 |

- `A → C` 是头条数字。
- `A → B` 是**纯 SDK 改动**能买到的。
- `B → C` 是**编译**能买到的 —— Stage 0 真正要的就是这个。

---

## 为什么是这个装置，不是 `bench/nojit-frame-bench.mjs`

那一个存在的目的是**从 Mac 上模拟 iPhone**，所以它才需要 Bun + JSC + 关 JIT 那一整套解释。

Stage 0 不需要 iOS。它需要的是：一个无 JIT 的解释器，和一个原生编译器，跑在**同一颗 CPU
上、同一份字节上、同一个进程里**。QuickJS 正是原生宿主真正出货的解释器（它在任何平台上
都没有 JIT），而且就链在这里。于是这个比较不再有任何需要辩解的地方。

## 公平规则（每一条都重要）

- 四个变体走**同一份候选实体列表**，付**同一次** sparse→dense 间接寻址，那是真查询要付的；
- 四个变体从**同一份池快照**开始，每轮 `reset()`；
- 算术在**全部四个**里都是 f64 运算 + f32 存储。因为那就是 JS `number` 的语义，
  因此也是 AOT 编译器不得不发的代码。C++ 用 float 算是**另一个程序**，不是更快的同一个；
- 跑完对池做 FNV-1a，**四个校验和必须相同**。不同就说明它们没在做同一件事，
  那一轮的所有计时都不作数（装置会直接退出码 2）；
- `variants.js` 里的字段偏移由 `bench.cpp` 的 `static_assert(offsetof(...))`
  顶着真实 C++ 结构体校验。偏移漂了就编译不过，不会静默量出假数字。

## A 是保守的

真实的 `query.ts` 迭代器还要付：迭代器协议、`beginIteration/endIteration`、
变更过滤检查、每组件一次 `getters_[i]` 间接调用、`markChanged` 是函数调用而不是一次字节写。
这里一样都没算。**所以真实的 A 比这里量到的更慢**，A→C 是下界不是上界。

---

## 跑

```bat
bench\aot-stage0\build.bat                     :: MSVC 不在 PATH 上，脚本自己 call vcvars
build\cmake\aot-stage0\bench_aot_stage0.exe
```

| 环境变量 | 默认 | 含义 |
|---|---|---|
| `BENCH_ENTITIES` | 5000 | 实体数 |
| `BENCH_FRAMES` | 600 | 计时帧数 |
| `BENCH_WARMUP` | 60 | 热身帧数 |
| `BENCH_BODY` | `thin` | `thin` = 速度积分，3 个乘加；`thick` = 加限速（sqrt）与边界回绕，约 25 flops |
| `BENCH_ORDER` | `dense` | `scattered` = 池被 churn 过，候选顺序不等于稠密顺序 |
| `BENCH_VARIANTS` | 源码目录 | `variants.js` 的路径 |

**先跑 `BENCH_BODY=thick BENCH_ORDER=scattered`。** 那是四种组合里对 AOT 最不利的一种，
也是最像真实游戏的一种。`thin` + `dense` 是最讨好 AOT 的组合，单看它会高估。

## 两个必须知道的边界

1. **thin body 会高估。** 三个乘加的循环几乎全是解释器调度开销，那是 QuickJS 的最差
   情形、AOT 的最好情形。thick body 存在就是为了从另一侧把答案夹住。真实游戏在两者之间。
   （thick 的限速阈值刻意设成会触发的值 —— 一个永不执行的 `sqrt` 会让 thick 退化成
   "带死代码的 thin"，第一版就踩了这个坑。）

2. **这量的是系统循环，不是一帧。** 一帧里还有 C++ 的工作、渲染提交、调度本身。
   系统循环快 400 倍**不等于**帧快 400 倍 —— Amdahl 说了算。把这个数字翻译成帧预算，
   需要先量出「一帧里有多大比例是 TS 系统代码」，那是另一次测量，这里没做。

---

## `frame-share.mjs` —— Amdahl 的分母

上面那个装置量的是**系统循环**。它决定不了任何事:**一个快 400 倍、却只占一帧 5% 的循环,
只能让帧快 1.05 倍。** Stage 1 真正取决于的是**占比**。

```sh
node bench/aot-stage0/frame-share.mjs
BENCH_ENTITIES=20000 node bench/aot-stage0/frame-share.mjs
```

它启动真实引擎(headless)、打开 SDK 自带的 profiler(`App.enableStats()` 一直在记这些,
不需要新埋点),读出每个系统的 ms、各 phase 的 ms 和整帧。

**5000 实体 / node 24 / V8:**

| | ms/帧 | 占比 |
|---|---|---|
| `VelocitySystem` | 0.92 | 94% |
| 其余 11 个 TS 系统 | 0.01 | 1.6% |
| **TS 系统合计** | **0.93** | **95.6%** |
| 其余(C++/wasm + 调度) | 0.04 | 4.4% |

**一个交叉验证,值得单独说:** 真实的 `VelocitySystem` 在 V8 下 0.92 ms,而 Stage 0 手抄的
variant A 在 QuickJS 下 10.4–11.8 ms —— **比值 ~12×,是一个合理的解释器/JIT 比**。
说明 Stage 0 那份对生成访问器的转写没有在量别的东西。

### 但它看不见渲染器,所以它不报一个数字,报一张表

headless 帧里 `rest` 只有 0.04 ms,因为渲染器根本不在。拿它乘 Stage 0 的因子会得到一个
凯旋的数字,而那是**分母缺失的产物,不是发现**(本文件第一版就打印了一个)。所以改成扫描未知量:

设 `c` = 无 JIT 帧里原生 C++ 的占比,把 TS 那半边编译掉 F 倍后剩 `c + (1-c)/F`:

| C++ 占比 `c` | 帧加速 |
|---|---|
| 5% | 19.1× |
| 20% | 4.95× |
| **50%** | **1.99×** ← 再往上 AOT 就不是那根杠杆了 |
| 80% | 1.25× |
| 95% | 1.05× |

**结论的形状:渲染器的 C++ 得占到无 JIT 帧的一半以上,AOT 才会掉到 2× 以下。**
无 JIT 下 TS 那半边还会再涨 ~12 倍而 C++ 不变,`c` 只会更小。

---

## `frame-share-rendered.mjs` —— `c` 的实测值

上面那个跑 headless,看不见渲染器。这个驱动 pixel-gate 的 render host:真 WebGL2 上下文、
`scale-sprites` 场景、9801 个精灵,读 SDK 自己的 `ProfileRecorder`
(它把每系统 TS ms 和引擎 C++ `ES_PROFILE_SCOPE` ms 配在一起)。

```sh
node bench/aot-stage0/frame-share-rendered.mjs
```

**没有新埋点。** `ProfileRecorder.start()` 本来就同时打开两侧——它的注释写着为什么:
只开一侧「看起来像一个不花钱的引擎,而不是一个没被量的引擎」。缺的是 render host 上的
一扇门,不是一个 harness。

### 一个系统的 ms 里**包含**它调用的 C++

这份装置最容易搞错的就是这一件事,第一版就错了。系统的 ms 是绕着函数体量的墙钟,而引擎的
`ES_PROFILE_SCOPE` 跑在**它里面**——`submitScene` 是三次 wasm 调用,所以 `render.collect`
与 `render.finalize` 都坐在 `RenderSystem` 的 1.58 ms 之内。把「系统合计」加上「native
scope 合计」,就是把同一段时间数了两遍,并且记在 TypeScript 名下。

**一帧就是那些系统;TS 是把它们里面的 C++ 扣掉之后剩下的那部分。** 装置现在直接读 SDK 的
`buildFrameProfile`——编辑器的 profiler 面板和导入的 capture 读的是同一个答案——不再自己
推导第二遍。

| | |
|---|---|
| `c`(C++ 占 CPU 帧) | **73.3%** |
| 帧里最热的一项 | `render.collect` 0.63 ms —— **已经是 C++**,编译脚本碰不到它 |

### 不要用 Stage 0 的 396× 去乘整个 TS

396× 是在组件字节上的数值循环量的(AOT 最好情形),而这里 94% 的 TS 是 `RenderSystem`
—— draw 提交和过桥调用,不是算术。改用两个实测输入:

- `K` = QuickJS/V8 在真实 SDK 代码上 = **12×**
- 无 JIT 帧 = `K·TS + C++`

| 编译后的 TS | 帧加速 |
|---|---|
| 只追平 JIT(下界) | **3.7×** |
| 跑到原生速度(上界) | **4.9×** |

### 一个数字回答不了这个问题

`scale-sprites` 一行游戏逻辑都没有(`VelocitySystem` 只有 0.01 ms,那些副本没有 Velocity),
所以 73.3% 是 `c` 的**渲染那一端**;headless 全是游戏逻辑、没有渲染器,是另一端的 ~4%。
收益跟着 `c` 走,在这段区间上从 **145×** 到 **2.3×**。

**可用的结论是:AOT 的收益与「一帧里有多少是游戏逻辑」成正比** —— 逻辑重的游戏一个数量级,
以精灵为主的场景 3–5×。两端都过门槛,而它们相差 30 倍。

### 路上修的三个「测量报低」bug

- `es_profile_now_ms()` 在非 Emscripten 下 `return 0.0` —— 那四个 render scope 在
  桌面 / Android / iOS 上**从来就是 0**。已修成 `std::chrono::steady_clock`。
- `nativeScopes` 是 `{name, ms}[]` 不是 Record,按 Record 读会得到安静的 `(none recorded)`,
  报出 `c = 0%`。
- 上面那条双计。它把 `c` 报成 43.5% 而不是 73.3%,帧加速报成 7.2–16.0× 而不是 3.7–4.9×,
  而且它带的结论是**反的**:「一帧里最烫的是脚本」不成立,最烫的是 `render.collect`。

三个是同一类错误:**一个报低的测量,看起来像一个好消息。**
