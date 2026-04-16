#!/usr/bin/env python3
"""EHT entry point — run with: python -m eht [options]"""

import argparse
from pathlib import Path

from .parser import CppParser
from .generators import (
    EmbindGenerator, TypeScriptGenerator, MetadataGenerator,
    AnimTargetGenerator, PtrLayoutGenerator,
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

    if args.verbose:
        print(f"  Found {len(cpp_parser.enums)} enums")
        print(f"  Found {len(cpp_parser.components)} components")
        for comp in cpp_parser.components:
            print(f"    - {comp.name}: {len(comp.properties)} properties")

    if not cpp_parser.components:
        print("Warning: No components found!")
        return 1

    # ── C++ Embind Bindings ──
    args.output.mkdir(parents=True, exist_ok=True)
    embind_path = args.output / 'WebBindings.generated.cpp'
    print(f"Generating: {embind_path}")
    embind_gen = EmbindGenerator(cpp_parser.components, cpp_parser.enums)
    embind_path.write_text(embind_gen.generate(), encoding='utf-8')

    # ── TypeScript Definitions ──
    ts_gen = TypeScriptGenerator(cpp_parser.components, cpp_parser.enums)
    ts_content = ts_gen.generate()

    args.ts_output.mkdir(parents=True, exist_ok=True)
    ts_path = args.ts_output / 'wasm.generated.ts'
    print(f"Generating: {ts_path}")
    ts_path.write_text(ts_content, encoding='utf-8')

    ts_src_path = args.ts_output / 'src' / 'wasm.generated.ts'
    if ts_src_path.parent.exists():
        print(f"Generating: {ts_src_path}")
        ts_src_path.write_text(ts_content, encoding='utf-8')

    # ── Component Metadata ──
    meta_gen = MetadataGenerator(cpp_parser.components, cpp_parser.enums)
    meta_content = meta_gen.generate()

    meta_path = args.ts_output / 'src' / 'component.generated.ts'
    if meta_path.parent.exists():
        print(f"Generating: {meta_path}")
        meta_path.write_text(meta_content, encoding='utf-8')

    # ── Animation Targets ──
    anim_gen = AnimTargetGenerator(cpp_parser.components, cpp_parser.enums)

    anim_hpp_path = Path('src/esengine/animation') / 'animTargets.generated.hpp'
    print(f"Generating: {anim_hpp_path}")
    anim_hpp_path.write_text(anim_gen.generate_hpp(), encoding='utf-8')

    anim_ts_path = args.ts_output / 'src' / 'timeline' / 'animTargets.generated.ts'
    if anim_ts_path.parent.exists():
        print(f"Generating: {anim_ts_path}")
        anim_ts_path.write_text(anim_gen.generate_ts(), encoding='utf-8')

    # ── Pointer Layouts & Accessors ──
    ptr_gen = PtrLayoutGenerator(cpp_parser.components, cpp_parser.enums)
    ptr_path = args.ts_output / 'src' / 'ptrLayouts.generated.ts'
    if ptr_path.parent.exists():
        print(f"Generating: {ptr_path}")
        ptr_path.write_text(ptr_gen.generate(), encoding='utf-8')

    accessor_path = args.ts_output / 'src' / 'ecs' / 'ptrAccessors.generated.ts'
    if accessor_path.parent.exists():
        print(f"Generating: {accessor_path}")
        accessor_path.write_text(ptr_gen.generate_accessors(), encoding='utf-8')

    print("[OK] Done!")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
