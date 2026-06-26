# How Estella Is Licensed and Funded

This is a public, plain-language statement of Estella's licensing and business
model. We want there to be **zero ambiguity** about what you can do with Estella and
how the project pays for itself.

## TL;DR

- **Estella is licensed under [Apache-2.0](LICENSE).** Use it for anything,
  including commercial games and commercial products, free of charge. No royalties,
  no seat fees, no revenue thresholds, no "free for indies, paid for studios" tier.
- **The whole engine is open and stays open.** The engine runtime, the SDK, the
  editor, the build CLI, and the runtime loader are all Apache-2.0. We do not hold
  core features back behind a paywall.
- **We fund the project from things built _around_ the engine, not from the engine
  itself** — sponsorship, optional hosted/"pro" add-ons, a marketplace, and paid
  support. Every one of those is optional; none of them gate the open-source engine.
- **One caveat that is not ours to waive:** the bundled **Spine Runtimes are not
  open source**. If you ship a game using Estella's Spine integration, you need a
  Spine license from Esoteric Software. See [NOTICE](NOTICE).

## Why Apache-2.0, and why we reverted the noncommercial experiment

For a short window (v0.13.0, June 2026) Estella shipped under the PolyForm
Noncommercial License, with a separate paid commercial license. We reverted that in
v0.14.0. The honest reasons:

- A noncommercial-only engine can't be adopted by the people who would actually
  build on it — studios, freelancers, and anyone shipping a paid game. Adoption is
  the foundation everything else here depends on.
- "Free for noncommercial, pay us for commercial" creates friction and uncertainty
  exactly when a developer is deciding whether to commit. That uncertainty is more
  expensive to the project than the license revenue it might have produced.
- We'd rather compete on being genuinely good and genuinely open than on license
  enforcement.

We chose **Apache-2.0** (over MIT) because it adds an explicit **patent grant** and a
clear **trademark** boundary, which protect both users and the project, while still
being fully permissive and commercial-friendly. It is also compatible with the
permissive licenses of our bundled dependencies.

### Our promise (no rug-pull)

The Apache-2.0 grant is **irrevocable** for the code released under it. We can't take
back the rights you already have, and we don't intend to. The core engine will
remain under a permissive OSI-approved license. If governance ever moves (for
example, to a foundation), it will only move in a direction that keeps the engine
open.

## What is always free and open

Everything needed to build and ship a game is Apache-2.0 and lives in this repo:

- the C++/WebAssembly engine runtime and renderer,
- the TypeScript SDK (`esengine`) and the web loader (`@esengine/web-loader`),
- the visual editor,
- the build/CLI tooling,
- documentation and examples.

We will not move a feature from this list behind a paywall. New core capabilities
land here, openly.

## How the project is funded

Four pillars, all built _alongside_ the open engine rather than by restricting it:

### 1. Sponsorship & donations
Recurring sponsorship (e.g. GitHub Sponsors / OpenCollective) and one-off donations
from individuals and companies that depend on Estella. Sponsors may get recognition
and a louder voice on the roadmap — never exclusive access to core features.

### 2. Optional hosted & "pro" add-ons (open-core, done honestly)
Convenience products that sit on top of the open engine and are worth paying for
because they save time, not because the engine was crippled without them — for
example a hosted/cloud editor, team collaboration, a managed build-and-publish
pipeline, or a pro asset pipeline. These are **separate products**: the open-source
engine is fully usable, self-hostable, and shippable without any of them.

### 3. Marketplace
A place to buy and sell assets, templates, and plugins, with the project taking a
small cut. The engine and the ability to load third-party content stay free; the
marketplace is an optional storefront.

### 4. Support, training & consulting
Paid priority support, training, and custom development for studios that want a
direct line or specific work done. The community gets best-effort support for free
via Discord/issues/QQ.

## Boundaries we hold ourselves to

- The **core engine stays Apache-2.0** and stays feature-complete on its own.
- Paid offerings are **additive and optional** — they never remove or gate
  functionality that is in the open-source engine today.
- We won't make the open build deliberately worse to push the paid one.
- **Trademarks:** Apache-2.0 covers the code, not the "Estella"/"ESEngine" names and
  logos. Please say your project "uses Estella," but don't ship a fork under the
  Estella name or imply official endorsement.
- **Attribution:** if you redistribute Estella (including inside a closed-source
  product, which Apache-2.0 allows), keep the LICENSE and NOTICE and mark changed
  files — see [NOTICE](NOTICE) and Apache-2.0 §4.

## Status

These funding pillars describe the direction, not a finished storefront — most are
not live yet. What **is** committed today is the licensing: Apache-2.0, free for
commercial use, no rug-pull. As paid offerings come online they'll be announced
here and in the [CHANGELOG](CHANGELOG.md).

## Contact

Questions about licensing, sponsorship, or commercial support: **359807859@qq.com**
· [Discord](https://discord.gg/sAX6PXZ9) · QQ Group 481923584.
