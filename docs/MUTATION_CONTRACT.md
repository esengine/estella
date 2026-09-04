# 变更观测契约（Mutation Observation Contract）

> 目标读者：引擎维护者 / AI 协作代理。
> 本文记录 **PR6c 第一刀的普查结果**：引擎当前允许哪些写法改变 World、其中哪些
> ChangeTracker 观测得到、以及把读接口收紧成只读要付多少迁移成本。
> 本文**不改任何实现**，它是拍板前的证据。

## 0. 问题

`bench/replication-dirty/` 的四臂实验（PR6b）在性能上给了 N1 一个可用的答案，但它的
completeness probe 顺手证伪了一个前提：**合法代码拿到脚本组件的 live reference 后原地写，
shadow scan 看得见，ChangeTracker 看不见。** 只要还有一条这样的路径，ChangeTracker 就不能
充当权威的 candidate 来源——那部分状态会直接停止复制，而且没有任何地方会说一声。

所以在测 crossover 之前，先要回答的是**语义**问题，而不是性能问题：

> 引擎的「读」接口和「写」接口，边界到底在哪？

## 1. 两台机器

| 机器 | 问什么 | 怎么跑 |
|---|---|---|
| `tools/mutation-contract.mjs` | 每条访问路径**实际上**做了什么：值真的变了吗？tracker 看到了吗？ | `node tools/mutation-contract.mjs` |
| `tools/mutation-census.mjs` | 这个仓库**实际上**有多少代码在通过读句柄写 | `node tools/mutation-census.mjs` |

两台都对自己做过标定：

- contract fixture 被**三次 sabotage 验证**过：让 `tryGet` 返回拷贝、让 `tryGet` 记 changed、
  让 `Mut` 写回不再报告——每次都只红在它守的那几行，撤掉即回绿。
  第二次 sabotage 顺带暴露了 fixture 自己的一个洞：`snapshot()` 经由 `tryGet` 读，而它排在
  observed 计算之前，读若有副作用就会污染判决。已改成先问 observed 再取快照。
- census 有 `--self-test`：它声称能识别的每种形态都写成正样本并断言命中数，
  所以「零发现」永远不可能被误读成「仓库很干净」。标定过程中抓到过它自己两个缺陷：
  `Object.assign` 被同时记成 write 和 escape；以及 **alias 链上的写回没被识别**
  （`const p = t.position; p.x = 1; world.set(e, T, t)` 被误判为静默写——
  multiplayer-arena 的移动函数正是这个形状）。

## 2. 运行时契约：18 条路径的实测

`node tools/mutation-contract.mjs`，wasm 与 SDK 均为当前 HEAD 构建：

| 访问路径 | 值真的变了 | tracker 看到 | 判定 |
|---|---|---|---|
| `world.set` / `insert` / `remove` | 是 | 是 | 已报告 |
| `world.set`（嵌套 shape / builtin） | 是 | 是 | 已报告 |
| `world.markChanged` | 否 | 是 | 已报告 |
| `Query(Mut(C))` 写回（脚本 / builtin） | 是 | 是 | 已报告 |
| `world.get(e,C).f = v`（脚本） | **是** | **否** | **静默写** |
| `world.tryGet(e,C).f = v`（脚本） | **是** | **否** | **静默写** |
| `world.get/tryGet(e,C).nested.x = v`（脚本） | **是** | **否** | **静默写** |
| 裸 `Query(C)` 行写入（脚本，两种 shape） | **是** | **否** | **静默写** |
| 句柄跨 tick 持有后再写 | **是** | **否** | **静默写** |
| `world.get/tryGet(e,C).nested.x = v`（builtin） | 否 | 否 | 惰性（写被丢弃） |
| 裸 `Query(C)` 行写入（builtin） | 否 | 否 | 惰性（写被丢弃） |

**18 条路径，7 条是静默写。**

三个必须记下来的事实：

1. **脚本组件的两种存储都是 live 的。** 全 scalar 的 shape 被 `ScriptStorage` 池化成 wasm 堆
   视图，带嵌套对象的 shape 是普通 JS 对象——两者 `get`/`tryGet`/裸 `Query` 交出去的都是
   存储里那个对象本身，写它就是写 World。PR6b 只证过池化那一种。
2. **同一个 API 在 builtin 上是另一种错法。** `get`/`tryGet` 对 builtin 返回一次性投影，
   写它既不改 World 也不报告——不是「安全」，是**静默丢弃**。裸 `Query(C)` 对 builtin 更糟：
   `resolvePtrGetter` 返回的是一个**跨行复用的 scratch 对象**，写入会被下一行的 fill 覆盖。
   于是同一行代码 `row.field = v` 在脚本组件上悄悄改了世界，在 builtin 上悄悄什么都没做。

   > **PR6c.2 已修这一格的读侧。** 那不只是写侧的陷阱：`toArray()` 曾把三行返回成同一个
   > 对象、值全等于最后一行，纯读也是错的。现在 `forEach` 是明确的 borrowed 快路，
   > iterator / `single` / `toArray` 交出可保留的行；代价是每行一次分配
   > （脚本组件 1.2x，引擎组件 1.7x）。判据见 `sdk/tests/query-row-lifetime.test.ts`。
3. **`Query` 的文档承诺没有被执行层兑现。** 文档写的是「除非包在 `Mut` 里否则只读」，
   但裸 `Query(C)` 的 getter 对脚本组件就是 `storage.get(e)`。承诺只存在于类型注释里。

## 3. 用量普查：收紧类型要付多少

`node tools/mutation-census.mjs`，扫描 1694 个文件（`sdk/src`、`sdk/tests`、`examples`、
`desktop/src`，编辑器子模块经其自身索引读取）：

```
280  处经由读句柄的写
237  处是「读—改—写回」（后面跟着 set/insert/markChanged，今天就正常报告）
 43  处是静默写（值变了，没有任何人观测到）
109  处句柄逃逸出本普查的视野（传进了别的函数）
```

**这两个数字回答的是两个不同的问题，不能混用：**

- **43** 是今天就存在的缺陷数量。
- **280** 是把 `get`/`tryGet`/裸 `Query` 收成 `DeepReadonly` 的迁移面——
  因为那 237 处合法的读—改—写回**同样是在写一个读句柄**，类型收紧会一并挡住。

### 43 处静默写的分布

| 位置 | 处数 | 性质 |
|---|---|---|
| `sdk/src/ui/text/text-input-plugin.ts` | 15 | 引擎自身 |
| `sdk/src/ui/input/drag.ts` | 12 | 引擎自身 |
| `sdk/tests/*` | 13 | **测试固化了这个语义** |
| `examples/celestial-heights/src/systems/combat.ts` | 3 | flagship 游戏的伤害结算 |

三处定罪：

- **`world.test.ts` 有一个 describe 块就叫 `component data mutations`**，其中两个用例名为
  `should allow mutating component data` 和 `should reflect mutations immediately`，直接断言
  `world.get(...).x = 100` 之后值确实变了。`scene.test.ts` 更直白，注释写着
  “Mutate the LIVE component”。**这不是无意的疏漏，是有测试背书的既有公开语义**——
  收紧类型是推翻它，不是补上一个未定义行为。
- **`text-input-plugin.ts` 写了 8 次 `ti.dirty = true`，而 `TextInputData.dirty` 全仓零读者。**
  这是同一个问题的化石：有人需要「这个组件变了」这个信号，而经 `world.get` 原地写不会让
  tracker 报告，于是他在组件里自己加了一个 dirty 字段——然后这个字段从来没有被读过一次。
- **`damageSystem` 的血量结算完全静默**：`world.get(target, Health)` 之后 `health.current -=
  blow.amount`，没有任何写回。任何 `Changed(Health)` 消费者或 Health 的复制都收不到它。
  同一目录下 `layout.ts` 正在用 `world.anyChangedSince(UINode, ...)` 决定要不要重算布局——
  同一个 tracker，一边被当权威，一边被绕过。

## 4. 待裁定

普查给出的结论是明确的：**`get`/`tryGet`/裸 `Query` 必须收成只读**，而且必须是
`DeepReadonly` 而不是浅 `Readonly`（`c.nested.x = 1` 这条路径已实测为静默写）。

但 280 这个数字意味着**不能只收紧类型**。237 处读—改—写回是今天合法且报告正常的写法，
把它们全部改成「自己复制整个组件再 set」既是无谓的迁移，也会让热路径多一次拷贝。
所以收紧读接口必须与一个符合人体工学的单实体写接口同时落地
（`world.update(e, C, draft => {...})` 之类），否则这一刀会把成本转嫁给所有调用方。

同时未判定、留给后续的两件：

- **AOT 写回**：`AotDispatch.markChanged_` 按 `q.mutated`（即声明了 `Mut` 的组件）逐行标记，
  语义上与 `Mut` 一致。但本轮 fixture 没有覆盖它——跑它需要编译产物，
  留作 conformance 那条线的一格，**不计入本文的「已实测」**。
- **`cleanRemovedBuffer` 的归属权**：它是全局 destructive cleanup，而每个
  `RemovedQueryInstance` 各自持有 `lastRunTick`。复制层若替所有 `Removed()` 消费者删历史，
  会让 frontier 落后的消费者永久错过那段 removal。这是正确性契约而不是内存优化，
  属于 PR6d（共享 retention watermark），本文只记录事实。
