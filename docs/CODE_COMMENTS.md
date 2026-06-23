# Estella 注释规范（Code Comment Convention）

> 适用于**所有源码**（TypeScript / C++）。设计文档（`docs/*REARCH*.md`、`RC12_*.md` 等）仍用中文；**代码注释一律英文**。
> 本规范由代码库已有的事实风格统一而来（现状：注释 100% 英文、Doxygen `@file/@brief` 头 + JSDoc + 解释 why 的内联注释，只是应用不一致）。
> **执行策略**：新增/改动一律遵守；改动某文件时**顺手把它的注释规范化（改到哪清到哪）**，不做一次性全仓批量重写。

---

## 0. 总则

- **语言：英文。** 注释、JSDoc、TODO 一律英文。
- **少注释、按需注释。** 默认**不写**注释；只有当代码的"为什么"确实不显然时才加一行。**好代码（清晰命名 + 结构）自解释，不需要注释陪读。** 宁可没有，也不要为凑而写。
- **解释 why，不复述 what。** 注释讲"为什么这么写 / 不变量 / 陷阱 / 契约"，不要把代码再用英文念一遍（`// loop over entities` 这种叙述性注释一律删）。
- **简洁、现在时、完整句子，首字母大写。**
- **不留注释掉的死代码** —— 删就删（git 记得住）。
- **不留"墓碑"注释。** 删/移代码时**不要**再加一句注释说明"某某被删除了/移到哪了/曾经是什么"（如 `// (X was removed ...)`）——git 历史记得住，这种注释只会变噪音 + 过时信息。直接删干净。
- **自包含**：注释把"为什么"直接讲清楚，**能独立看懂**。
- **不要在注释里写内部/临时的流程代号**（审计编号如 `A20`、工单号、私有缩写）——代码读者查不到、而且会过时（那些文档常常根本没进仓库）。确需指向长期存在的**已提交**文档时，写**真实路径**，如 `docs/REARCH_EDITOR_REALM.md`；`file.ts:123` 这种可定位的引用可以。

## 1. 文件头 `@file` / `@brief`

每个非平凡源文件顶部一个 Doxygen 块：

```ts
/**
 * @file    sceneManager.ts
 * @brief   Scene lifecycle — register / load / unload + transitions.
 *
 * (Optional) A longer note on why this file exists or how it fits, only when
 * the one-line @brief isn't enough.
 */
```

- `@brief` 一行说清该文件的**职责**。
- 纯 re-export 的 barrel / `index.ts` 可只留 `@file` + 一行 `@brief`。
- 生成文件（`*.generated.*`）**不**手写文件头。

## 2. 公共 API 文档（JSDoc / Doxygen `/** */`）

导出的函数、类、接口，以及**含义不显然**的字段，用 `/** */`：

```ts
/**
 * Roll back a load that threw partway, so a retry starts clean instead of
 * wedging on a stuck `status === 'loading'` instance whose loadPromise was
 * already deleted.
 *
 * @param required When the manifest explicitly named the entry, a missing file
 *   is an error; otherwise it just means the project has no such module.
 */
```

- 写**契约 / 意图 / 边界**，不复述签名。
- `@param` / `@returns` **仅在不显然时**写——别给 `add(a, b)` 写 "@param a the first number"。

## 3. 内联注释

解释非显然的决策、不变量、陷阱；紧贴被解释的代码：

```ts
// The loader keeps running even when the deadline wins the race; release
// whatever it produces so a post-deadline GL texture doesn't leak.
clearTimeout(timer);
```

反例（**禁止**，注释里塞内部审计代号，读者无从查起）：

```ts
// Release it instead of leaking it (audit A20).   // ❌ "A20" 是什么？
```

反例（**禁止**，复述代码）：

```ts
// increment i
i++;
```

## 4. 分节分隔符

大文件内分组，用对齐的分隔符（沿用现有风格）：

```ts
// =============================================================================
// Component Definition
// =============================================================================
```

## 5. TODO / FIXME

说清"要做什么 / 为什么"，不留裸 `// TODO`，也不要塞内部代号：

```ts
// TODO: guard against stride_ === 0 before the divide (lost-context path).
```

## 6. C++ 特例

与上一致。文件头：

```cpp
/**
 * @file    SparseSet.hpp
 * @brief   Paged sparse-set component storage (one page = 4096 slots).
 */
```

- 公共方法/类用 Doxygen `/** */`；实现细节用 `//`。
- `@param` / `@return` 同样只在不显然时写。

---

## 速查清单（提交前自检）

- [ ] 注释是英文？
- [ ] 改动的文件有 `@file`/`@brief` 头？
- [ ] 新增/改动的导出 API 有 `/** */`，且讲的是 why/契约而非签名？
- [ ] 内联注释解释的是"为什么"，没有复述代码？
- [ ] 没有注释掉的死代码、没有裸 TODO？
- [ ] 注释**自包含**，没有内部流程代号（如 `audit A20`、工单号）？指向文档时用的是已提交文件的真实路径？
