# Provenance & Authorship Record

This document is an authoritative, dated record of the origin and authorship of
**Estella / ESEngine**, maintained to support copyright ownership and any future
enforcement. It is a public statement of fact; the operational details used to
prove that a given copy derives from this project are held privately by the
copyright holder.

## Ownership

- **Copyright holder:** ESEngine Team (sole author/maintainer).
- **License:** PolyForm Noncommercial License 1.0.0 (see [LICENSE](LICENSE)).
  Commercial use requires a separate commercial license — contact 359807859@qq.com.
- **Authorship:** the entire codebase was written by a single author. As of this
  writing the Git history contains 1307 commits, all from one identity. There are
  no third-party copyright contributions to the first-party source (bundled
  third-party components live under `third_party/` and keep their own licenses;
  see [NOTICE](NOTICE)).

## Timeline

| Date (UTC)  | Event                                                         |
|-------------|---------------------------------------------------------------|
| 2026-01-25  | First commit of the project.                                  |
| through v0.12.3 | Released under the MIT License.                           |
| 2026-06-22 (v0.13.0) | Relicensed to PolyForm Noncommercial License 1.0.0.  |

Releases at or before `v0.12.3` remain available under MIT **for those snapshots
only** — that grant is irrevocable for code already published under it. From
`v0.13.0` onward the project is noncommercial-licensed and commercially
dual-licensed by the copyright holder.

## Embedded origin signatures

Shipped builds of the runtime, and the project files the engine produces, carry
embedded origin signatures. These survive compilation into the WebAssembly
binary and propagate into serialized project data. Their purpose is to let the
copyright holder identify copies — including closed-source redistributions —
that derive from this project.

The authoritative registry of these signatures, including their exact values and
locations, is **held privately by the copyright holder** and is not published
here. Removing or altering them does not affect copyright ownership and may
constitute additional removal of copyright-management information.

## How origin is verified

1. **Git history** — this repository's full commit history and signed release
   tags establish first authorship and dates. The canonical remote is
   `github.com/esengine/estella`.
2. **Release artifact hashes** — published builds are recorded by SHA-256 so a
   redistributed binary can be matched against a known release.
3. **Embedded signatures** — see above; matched against the private registry.
4. **Software copyright registration** — registration of the software copyright
   is maintained with the competent authority as prima facie evidence of
   ownership. (Registration number: _to be added once issued._)

## Reporting / enforcement contact

Suspected unlicensed (commercial) use or redistribution: 359807859@qq.com.
