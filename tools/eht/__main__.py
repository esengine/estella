#!/usr/bin/env python3
"""EHT entry point — run with: python -m eht [options]"""

import argparse
from pathlib import Path

from .parser import CppParser
from .abi import compute_abi_hash
from .generators import (
    EmbindGenerator, TypeScriptGenerator, MetadataGenerator,
    PtrLayoutGenerator, EditorAPIGenerator, NativeBindingsGenerator,
    NativeFunctionsGenerator,
)


def _emit_native_functions(args) -> int:
    """Emit the opt-in QuickJS wrappers for the engine's binding entry points —
    the same declarations embind registers, so the two cannot drift."""
    headers = []
    for path in args.native_functions:
        if not path.is_file():
            print(f"[FAIL] --native-functions: no such header: {path}")
            return 1
        # The generated TU includes the header the way the binding TUs do.
        include = f'esengine/bindings/{path.name}'
        headers.append((include, path.read_text(encoding='utf-8')))

    gen = NativeFunctionsGenerator(headers, shim_header=args.native_shim)
    if args.native_functions_output is not None:
        content = gen.generate()
        args.native_functions_output.parent.mkdir(parents=True, exist_ok=True)
        print(f"Generating: {args.native_functions_output}")
        args.native_functions_output.write_text(content, encoding='utf-8')
        print(f"  {len(gen.emitted)} entry point(s) bound")
    # The TS half: the same entry points as the object the SDK's plugins call, so
    # a plugin reaches whichever core is present without knowing which. Committed
    # (the SDK builds from source without running EHT), unlike the C++ wrappers.
    if args.native_functions_ts is not None:
        args.native_functions_ts.parent.mkdir(parents=True, exist_ok=True)
        print(f"Generating: {args.native_functions_ts}")
        args.native_functions_ts.write_text(gen.generate_ts(), encoding='utf-8')
    # Never a silent cap: what the wrappers cannot marshal is what still needs a
    # hand-written binding, so say it every run.
    for skip in gen.skipped:
        print(f"  skipped {skip.name}: {skip.reason}")
    return 0


def _emit_native(components, enums, args) -> None:
    """Emit the opt-in native (QuickJS) bindings from the parsed reflection —
    the native sibling of WebBindings.generated.cpp, one reflection source."""
    only = None
    if args.native_components:
        only = {n.strip() for n in args.native_components.split(',') if n.strip()}
    args.native_output.parent.mkdir(parents=True, exist_ok=True)
    print(f"Generating: {args.native_output}")
    native_gen = NativeBindingsGenerator(
        components, enums, shim_header=args.native_shim, only=only,
    )
    args.native_output.write_text(native_gen.generate(), encoding='utf-8')


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
    # Opt-in native (QuickJS) bindings. Off by default so the standard EHT run and
    # its committed *.generated.* files are unchanged; a native build passes this
    # to emit NativeBindings.generated.cpp into its build tree from the same source.
    parser.add_argument('--native-output', type=Path, default=None,
                        help='Also emit native QuickJS bindings to this .cpp path')
    parser.add_argument('--native-components', type=str, default=None,
                        help='Comma-separated component names to emit (default: all)')
    parser.add_argument('--native-shim', type=str, default='esn_shim.hpp',
                        help='Shim header the generated native TU includes')
    # With --native-output, emit ONLY the native bindings and skip the embind /
    # editor / TS generation. A native build just needs NativeBindings.generated.cpp;
    # this keeps that invocation single-purpose and from touching the committed
    # web/editor/TS *.generated.* files at all (no throwaway output dirs needed).
    parser.add_argument('--native-only', action='store_true',
                        help='With --native-output: emit only the native bindings')
    # Opt-in QuickJS wrappers for the engine's binding ENTRY POINTS (renderer_*,
    # uiLayout_*, …), parsed from the bindings headers embind registers from.
    parser.add_argument('--native-functions', type=Path, nargs='+', default=None,
                        help='Bindings headers to emit native QuickJS wrappers for')
    parser.add_argument('--native-functions-output', type=Path, default=None,
                        help='Where to write the generated wrappers (.cpp)')
    parser.add_argument('--native-functions-ts', type=Path, default=None,
                        help='Also write the TS-side native engine API (.ts)')
    args = parser.parse_args()

    print("EHT - ESEngine Header Tool")

    # Function wrappers are parsed from declarations, not component reflection —
    # emit them before (and independently of) the component pass.
    if args.native_functions:
        if args.native_functions_output is None and args.native_functions_ts is None:
            print("[FAIL] --native-functions needs --native-functions-output and/or "
                  "--native-functions-ts.")
            return 1
        code = _emit_native_functions(args)
        if code != 0 or args.native_output is None:
            return code

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

    # ── Native-only fast path ──
    # A native build needs just NativeBindings.generated.cpp, from the same
    # reflection — so skip all embind/editor/TS work and touch no committed files.
    if args.native_only:
        if args.native_output is None:
            print("[FAIL] --native-only requires --native-output.")
            return 1
        _emit_native(cpp_parser.components, cpp_parser.enums, args)
        print("[OK] Done (native bindings only)!")
        return 0

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

    # ── Native QuickJS Bindings (opt-in) ──
    if args.native_output is not None:
        _emit_native(cpp_parser.components, cpp_parser.enums, args)

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
