# Changelog

All notable changes to Estella are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [VERSIONING.md](VERSIONING.md) for what "the public API" means for an engine
like Estella (the SDK API, the editor project/asset formats, and the WASM ABI) and
what we treat as a breaking change.

Version numbers here track the **Estella release** — the engine + editor + SDK
shipped together, matching the Git tags and GitHub Releases. The `esengine` SDK npm
package carries its own version line; npm consumers should read the **SDK** notes in
each entry.

## [Unreleased]

## [0.14.0] - 2026-06-26

### Changed
- **License: relicensed to the Apache License, Version 2.0.** Estella is now free
  for any use, including commercial use. This reverts the noncommercial restriction
  introduced in v0.13.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
  [BUSINESS_MODEL.md](BUSINESS_MODEL.md).
- Every first-party source file now carries `SPDX-License-Identifier: Apache-2.0`.
- Contributing terms simplified to the standard Apache-2.0 **inbound = outbound**
  model; the previous Contributor License Agreement and commercial-relicensing grant
  are removed (see [CONTRIBUTING.md](CONTRIBUTING.md)).

### Added
- This `CHANGELOG.md` and a published versioning policy ([VERSIONING.md](VERSIONING.md))
  with an explicit Semantic Versioning commitment.
- A public business-model statement ([BUSINESS_MODEL.md](BUSINESS_MODEL.md)).

### Notes
- No code behavior changed in this release — it is a licensing/governance release.
- The bundled Spine Runtimes remain proprietary and are unaffected by this
  relicense; shipping a game that uses Estella's Spine integration still requires a
  Spine license from Esoteric Software (see [NOTICE](NOTICE)).

## [0.13.0] - 2026-06-22

### Changed
- Relicensed to the PolyForm Noncommercial License 1.0.0 (noncommercial use only,
  with a paid commercial license). **Superseded by 0.14.0** — this window is closed
  and Estella is permissively licensed again.

## Earlier history

Releases up to and including **v0.12.3** were published under the **MIT License**;
that grant remains valid for those snapshots. A detailed per-version changelog was
not kept before this file was introduced — see the Git history at
`github.com/esengine/estella` for the full commit-level record since the first
commit on 2026-01-25.

[Unreleased]: https://github.com/esengine/estella/compare/v0.14.0...HEAD
[0.14.0]: https://github.com/esengine/estella/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/esengine/estella/compare/v0.12.3...v0.13.0
