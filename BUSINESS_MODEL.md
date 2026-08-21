# How Estella Is Licensed and Funded

This is a public, plain-language statement of Estella's licensing and business
model. We want there to be **zero ambiguity** about what you can do with Estella and
how the project pays for itself.

## TL;DR

- **The engine is licensed under [Apache-2.0](LICENSE).** Use it for anything,
  including commercial games and commercial products, free of charge. No royalties,
  no seat fees, no revenue thresholds, no "free for indies, paid for studios" tier.
- **The engine is open and stays open.** The runtime, the SDK, the asset pipeline,
  the build CLI, the runtime loader, the project templates and the plugin API are
  all Apache-2.0. Everything needed to build, run and ship a game is here.
- **The visual editor is not open source.** It is a separate product, developed in
  a private repository. This is a change from how Estella shipped through v0.55.0 —
  see [What changed with the editor](#what-changed-with-the-editor) below, which
  says plainly what we promised before and what we are doing instead.
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

### Our promise, and its limit

The Apache-2.0 grant is **irrevocable** for the code released under it. We can't take
back the rights you already have. The **engine** will remain under a permissive
OSI-approved license. If governance ever moves (for example, to a foundation), it
will only move in a direction that keeps the engine open.

The limit is now explicit, because the previous version of this promise was not:
it covers the engine. The editor moved out from under it, which is exactly the kind
of move this section used to be read as ruling out.

## What changed with the editor

Through **v0.55.0** the visual editor shipped in this repository under Apache-2.0,
and this document said the editor was part of what stays open, under a heading that
promised no rug-pull. **That is no longer true, and we are not going to pretend it
was never said.** From the next release the editor is developed in a private
repository and is a separate product.

Two things about that are worth stating precisely:

- **The Apache-2.0 grant on the editor code already released is irrevocable.**
  Every version up to and including v0.55.0 remains Apache-2.0 for everyone who has
  it. You may use, modify, fork and redistribute that code under those terms. We
  cannot take that back and are not trying to.
- **The engine's Apache-2.0 grant is unchanged and is what the rest of this
  document commits to.** The engine is not being made worse to push the editor: the
  split moved the engine's own verification INTO the engine, and the open repo now
  runs its own renderer gates rather than borrowing the editor's host.

If you were relying on the editor being open, that is a reasonable thing to have
relied on, and we would rather say so here than let you find out from a changelog.

## What is always free and open

Everything needed to build and ship a game is Apache-2.0 and lives in this repo:

- the C++/WebAssembly engine runtime and renderer,
- the TypeScript SDK (`esengine`) and the web loader (`@esengine/web-loader`),
- the asset pipeline and the build/CLI tooling,
- the project templates a new game starts from,
- the editor plugin API (`editor-api/`), so a plugin author needs no private code,
- documentation and examples.

We will not move a feature from this list behind a paywall. New core capabilities
land here, openly.

## How the project is funded

Four pillars, all built _alongside_ the open engine rather than by restricting it:

### 1. Sponsorship & donations
Recurring sponsorship (e.g. GitHub Sponsors / OpenCollective) and one-off donations
from individuals and companies that depend on Estella. Sponsors may get recognition
and a louder voice on the roadmap — never exclusive access to core features.

### 2. The editor, and optional hosted add-ons
The visual editor is a separate product built on top of the open engine, as are
things like team collaboration, a managed build-and-publish pipeline, or a hosted
build service. The open-source engine is fully usable, self-hostable, and shippable
without any of them: the SDK, the CLI and the templates are a complete path from an
empty directory to a shipped game on every target Estella supports.

### 3. Marketplace
A place to buy and sell assets, templates, and plugins, with the project taking a
small cut. The engine and the ability to load third-party content stay free; the
marketplace is an optional storefront.

### 4. Support, training & consulting
Paid priority support, training, and custom development for studios that want a
direct line or specific work done. The community gets best-effort support for free
via Discord/issues/QQ.

## Boundaries we hold ourselves to

- The **core engine stays Apache-2.0** and stays feature-complete on its own — a
  game can be built, run, packaged and shipped from this repository alone.
- Paid offerings are **additive and optional** — they never remove or gate
  functionality that is in the open-source engine today.
- We won't make the open build deliberately worse to push the paid one.
- When we change a licensing commitment, we say so where the old one was written,
  rather than quietly editing it away.
- **Trademarks:** Apache-2.0 covers the code, not the "Estella"/"ESEngine" names and
  logos. Please say your project "uses Estella," but don't ship a fork under the
  Estella name or imply official endorsement.
- **Attribution:** if you redistribute Estella (including inside a closed-source
  product, which Apache-2.0 allows), keep the LICENSE and NOTICE and mark changed
  files — see [NOTICE](NOTICE) and Apache-2.0 §4.

## Status

These funding pillars describe the direction, not a finished storefront — most are
not live yet. What **is** committed today is the engine's licensing: Apache-2.0,
free for commercial use. As paid offerings come online they'll be announced here
and in the [CHANGELOG](CHANGELOG.md).

## Contact

Questions about licensing, sponsorship, or commercial support: **359807859@qq.com**
· [Discord](https://discord.gg/sAX6PXZ9) · QQ Group 481923584.
