# Provenance & Authorship Record

This document is an authoritative, dated record of the origin and authorship of
**Estella / ESEngine**, maintained to support copyright ownership and enforcement
of the project's license terms. It is a public statement of fact; the operational
details used to prove that a given copy derives from this project are held
privately by the copyright holder.

## Ownership

- **Copyright holder:** ESEngine Team (sole author/maintainer).
- **License:** Apache License, Version 2.0 (see [LICENSE](LICENSE)). Estella is
  free for any use, including commercial use — there is no separate commercial
  license and no noncommercial restriction.
- **Trademarks:** the "Estella" and "ESEngine" names and logos are trademarks of
  the copyright holder. Apache-2.0 grants rights to the code, not to the marks
  (see [NOTICE](NOTICE)).
- **Authorship:** the entire first-party codebase was written by a single author.
  Every commit in the Git history is from one author identity. There are no
  third-party copyright contributions to the first-party source (bundled
  third-party components live under `third_party/` and keep their own licenses;
  see [NOTICE](NOTICE)). Because authorship is sole and undivided, the copyright
  holder has been able to relicense the project unilaterally — see the timeline.

## Timeline

| Date (UTC)            | Event                                                                                                                              |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------|
| 2026-01-25            | First commit of the project.                                                                                                       |
| through v0.12.3       | Released under the MIT License.                                                                                                     |
| 2026-06-22 (v0.13.0)  | Relicensed to the PolyForm Noncommercial License 1.0.0.                                                                            |
| 2026-06-26 (v0.14.0)  | Relicensed to the Apache License, Version 2.0 — reverting the noncommercial restriction. Estella is free for commercial use from this release onward. |

Each past release remains available under the license it shipped under, for those
snapshots only. Permissive grants already made are irrevocable for the code
published under them: the MIT grant on releases through v0.12.3, and the Apache-2.0
grant from v0.14.0 onward, cannot be withdrawn for those snapshots. The brief
PolyForm Noncommercial window (v0.13.x) is superseded by Apache-2.0 going forward;
see [BUSINESS_MODEL.md](BUSINESS_MODEL.md) for why the noncommercial experiment was
reverted.

## Embedded origin signatures

Shipped builds of the runtime, and the project files the engine produces, carry
embedded origin signatures. These survive compilation into the WebAssembly binary
and propagate into serialized project data. Apache-2.0 permits redistribution,
including in closed-source or commercial products, provided attribution is
preserved; the purpose of these signatures is to let the copyright holder confirm
that a given copy derives from this project and to detect cases where the required
LICENSE/NOTICE attribution has been stripped.

The authoritative registry of these signatures, including their exact values and
locations, is **held privately by the copyright holder** and is not published here.
Removing or altering them does not affect copyright ownership and may constitute
removal of copyright-management information.

## How origin is verified

1. **Git history** — this repository's full commit history and signed release tags
   establish first authorship and dates. The canonical remote is
   `github.com/esengine/estella`.
2. **Release artifact hashes** — published builds are recorded by SHA-256 so a
   redistributed binary can be matched against a known release.
3. **Embedded signatures** — see above; matched against the private registry.
4. **Software copyright registration** — registration of the software copyright is
   maintained with the competent authority as prima facie evidence of ownership.
   (Registration number: _to be added once issued._)

## Reporting / enforcement contact

Estella is free to use commercially, so commercial use is **never** a violation.
What the copyright holder still asks of redistributors, and will enforce:

- **Attribution** — Apache-2.0 §4 requires that you keep the LICENSE, retain the
  attribution notices, include the NOTICE text in your distribution, and mark any
  files you changed. Stripping the NOTICE or the per-file SPDX/copyright headers
  from a redistribution is a license violation.
- **Trademark** — shipping a fork or product under the "Estella" / "ESEngine" name
  or logo, or otherwise implying endorsement, is not permitted by the license.
- **Copyright-management information** — removing or altering embedded origin
  signatures or copyright notices may constitute removal of copyright-management
  information, independent of the Apache-2.0 grant.

Report suspected attribution or trademark violations: 359807859@qq.com.
