# Estella 注释规范（Code Comment Convention）

> 适用于**所有源码**（TypeScript / C++）。设计文档（`docs/*REARCH*.md`、`RC12_*.md` 等）仍用中文；**代码注释一律英文**。
> 本规范由代码库已有的事实风格统一而来（现状：注释 100% 英文、Doxygen `@file/@brief` 头 + JSDoc + 解释 why 的内联注释，只是应用不一致）。
> **执行策略**：新增/改动一律遵守；改动某文件时**顺手把它的注释规范化（改到哪清到哪）**，不做一次性全仓批量重写。

---

## 0. 总则

- **语言：英文。** 注释、JSDoc、TODO 一律英文。
- **解释 why，不复述 what。** 注释讲"为什么这么写 / 不变量 / 陷阱 / 契约"，不要把代码再用英文念一遍。
- **简洁、现在时、完整句子，首字母大写。**
- **不留注释掉的死代码** —— 删就删（git 记得住）。
- **带出处**：引用审计/设计依据时给标识，如 `audit A17`、`RC12 §E8`、`sceneManager.ts:264`。

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
// whatever it produces so a post-deadline GL texture doesn't leak (audit A17).
clearTimeout(timer);
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

带上下文或标识，不留裸 `// TODO`：

```ts
// TODO(audit A15c): guard stride_ === 0 before the divide.
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
- [ ] 引用审计/设计点时带了标识（`audit A17` / `RC12 §E8` / `file:line`）？
