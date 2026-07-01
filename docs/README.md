# Estella Documentation

A map of the docs in this folder — start here. Estella's documentation lives in
three layers: the developer-facing guides below, the generated C++ API reference
(Doxygen), and the published site at
[estellaengine.com/docs](https://estellaengine.com/docs).

## In this folder (`docs/`)

### Architecture & design

| Document | What it is | Language |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The engine's architecture **as it exists today** — modules, data flow, the WASM boundary. | English |
| [REARCHITECTURE.md](./REARCHITECTURE.md) | Architecture-of-record: the root-cause re-architecture plan (RC1–RC6, F1–F4) and the *target* design. | 中文 |
| `REARCH_2D_PARITY.md` | Architecture-of-record: the 2D feature-parity & modernization roadmap. *Local only — gitignored.* | 中文 |

### Conventions

| Document | What it is | Language |
|---|---|---|
| [CODING_STYLE.md](./CODING_STYLE.md) | C++ and TypeScript naming & formatting rules. | English |
| [CODE_COMMENTS.md](./CODE_COMMENTS.md) | The comment convention all source code follows (explain *why*, not *what*; English-only comments). | 中文 |

### Building & publishing

| Document | What it is |
|---|---|
| [SITE.md](./SITE.md) | How to build and publish the documentation site (Astro Starlight + Doxygen). |
| [Doxyfile](./Doxyfile) | Doxygen config; the C++ API reference is generated from `@file`/`@brief` headers in the source. |

## Language policy

Documentation language follows the **audience**, not the author:

- **English** — anything a user or external contributor reads: the root
  [README](../README.md), [CONTRIBUTING](../CONTRIBUTING.md), `ARCHITECTURE.md`,
  `CODING_STYLE.md`, and all governance docs.
- **中文** — internal architecture-of-record and roadmap documents written for
  maintainers: `REARCHITECTURE.md`, `REARCH_2D_PARITY.md`, and the comment
  convention itself.
- **Code comments (TypeScript / C++) are always English** —
  [CODE_COMMENTS.md](./CODE_COMMENTS.md) is the authoritative rule.

## Elsewhere in the repo

- **Governance (root):** [README](../README.md) · [CONTRIBUTING](../CONTRIBUTING.md) ·
  [CHANGELOG](../CHANGELOG.md) · [VERSIONING](../VERSIONING.md) ·
  [SECURITY](../SECURITY.md) · [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) ·
  [BUSINESS_MODEL](../BUSINESS_MODEL.md) · [PROVENANCE](../PROVENANCE.md) ·
  [LICENSE](../LICENSE) · [NOTICE](../NOTICE)
- **Subsystem docs:** [`sdk/src/ui/ARCHITECTURE.md`](../sdk/src/ui/ARCHITECTURE.md)
  (UI layer) · [`sdk/tests/README.md`](../sdk/tests/README.md) (SDK tests) ·
  [`desktop/README.md`](../desktop/README.md) (editor)
