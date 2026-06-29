#!/usr/bin/env python3
"""EHT entry point — run with: python -m eht [options]"""

import argparse
from pathlib import Path

from .parser import CppParser
from .abi import compute_abi_hash
from .generators import (
    EmbindGenerator, TypeScriptGenerator, MetadataGenerator,
    PtrLayoutGenerator, EditorAPIGenerator,
)


def main() -> int:
    parser = argparse.ArgumentParser(description='EHT - ESEngine Header Tool')
    parser.add_argument('--input', '-i', type=Path, nargs='+',
                        default=[Path('src/esengine/ecs/components')],
                        help='Input directories')
    parser.add_argument('--output', '-o', type=Path,
                        default=Path('src/esengine/bindings'),
                        help='Output directory for C++ bindings')
    parser.add_argument('--ts-output', type=Path, default=Path('sdk'),
                        help='Output directory for TypeScript')
    parser.add_argument('--verbose', '-v', action='store_true')
    args = parser.parse_args()

    print("EHT - ESEngine Header Tool")

    cpp_parser = CppParser()
    for input_dir in args.input:
        print(f"Parsing: {input_dir}")
        cpp_parser.parse_directory(input_dir)

    if cpp_parser.warnings:
        cpp_parser.print_warnings()

    # Abort before codegen on malformed metadata — emitting bindings from a bad
    # annotation would bake the mistake into committed *.generated.* files.
    if cpp_parser.errors:
        cpp_parser.print_errors()
        print(f"[FAIL] {len(cpp_parser.errors)} annotation error(s); aborting before codegen.")
        return 1

    # Emit components/enums in a stable alphabetical order so the generated files
    # are byte-reproducible across machines — Path.rglob order is filesystem-
    # dependent, which otherwise churns every committed *.generated.* file when a
    # different dev regenerates. (The ABI hash already canonicalizes by sorting.)
    cpp_parser.components.sort(key=lambda c: c.name)
    cpp_parser.enums.sort(key=lambda e: e.name)

    if args.verbose:
        print(f"  Found {len(cpp_parser.enums)} enums")
        print(f"  Found {len(cpp_parser.components)} components")
        for comp in cpp_parser.components:
            print(f"    - {comp.name}: {len(comp.properties)} properties")

    if not cpp_parser.components:
        print("Warning: No components found!")
        return 1

    # ── Boundary ABI: single source of truth ──
    # Compute pointer layouts and the ABI hash first; both the C++ bindings and
    # the TS metadata embed the same hash so connect() can verify they match.
    ptr_gen = PtrLayoutGenerator(cpp_parser.components, cpp_parser.enums)
    abi_hash = compute_abi_hash(
        cpp_parser.components, cpp_parser.enums, ptr_gen.layouts
    )
    print(f"ABI layout hash: {abi_hash}")

    # ── C++ Editor API ──
    editor_api_path = args.output / 'EditorAPI.generated.cpp'
    print(f"Generating: {editor_api_path}")
    editor_gen = EditorAPIGenerator(cpp_parser.components, cpp_parser.enums)
    editor_api_path.write_text(editor_gen.generate(), encoding='utf-8')

    # ── C++ Embind Bindings ──
    args.output.mkdir(parents=True, exist_ok=True)
    embind_path = args.output / 'WebBindings.generated.cpp'
    print(f"Generating: {embind_path}")
    embind_gen = EmbindGenerator(
        cpp_parser.components, cpp_parser.enums,
        layout_asserts=ptr_gen.generate_layout_asserts(),
        abi_hash=abi_hash,
    )
    embind_path.write_text(embind_gen.generate(), encoding='utf-8')

    # Resolve the TS source directory robustly. Callers historically pass either
    # the package root (`sdk`) or the source dir (`sdk/src`); detect which by
    # looking for the `ecs/` subfolder. Previously a `sdk/src` argument made every
    # `/ 'src' /` path resolve to a non-existent `sdk/src/src`, silently skipping
    # component.generated.ts / ptrLayouts / ptrAccessors. Generation must never
    # silently no-op a file.
    ts_root = args.ts_output
    if (ts_root / 'ecs').is_dir():
        ts_src_dir = ts_root
    else:
        ts_src_dir = ts_root / 'src'
    ts_src_dir.mkdir(parents=True, exist_ok=True)

    def write_ts(rel: str, content: str) -> None:
        out = ts_src_dir / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        print(f"Generating: {out}")
        out.write_text(content, encoding='utf-8')

    # ── TypeScript Definitions ──
    ts_gen = TypeScriptGenerator(cpp_parser.components, cpp_parser.enums)
    ts_content = ts_gen.generate()
    write_ts('wasm.generated.ts', ts_content)

    # ── Component Metadata ──
    meta_gen = MetadataGenerator(cpp_parser.components, cpp_parser.enums, abi_hash=abi_hash)
    write_ts('component.generated.ts', meta_gen.generate())

    # ── Pointer Layouts & Accessors ──
    write_ts('ptrLayouts.generated.ts', ptr_gen.generate())
    write_ts('ecs/ptrAccessors.generated.ts', ptr_gen.generate_accessors())

    print("[OK] Done!")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
