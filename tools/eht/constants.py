"""Constants marked `ES_CONST` — the boundary values that were hand-copied.

A mask the SDK also needs is otherwise written twice, and a wrong mask does not
fail: it decodes a stored cell into a different tile, or over-runs a fixed-size
upload. The C++ declaration is the author; the TS is generated from it and the
value joins the ABI layout hash, so a WASM binary and an SDK bundle built from
different values refuse each other at `connect()`.

Found by SCANNING rather than from a list: a constant that crosses says so at
its declaration, and a list of what to extract is the thing that goes stale.
"""

import re
from pathlib import Path
from typing import Dict, List, NamedTuple

from .parser import CppParser


class Constant(NamedTuple):
    """One `ES_CONST` declaration, and where it came from."""
    cpp_name: str
    ts_name: str
    value: int
    hex: bool
    header: str


#: The repository the generator and the headers it scans both live in.
_REPO = Path(__file__).resolve().parents[2]


def _cite(header: Path) -> str:
    """Where a reader finds the declaration, named from the repository root.

    The absolute path of whichever machine generated last is not a citation: it
    is a whole-file diff for everyone else, and it turns any regenerate-and-
    compare check into a report about the host rather than about the code. So an
    unciteable header is a failure, not a fallback to the absolute path.
    """
    try:
        return header.resolve().relative_to(_REPO).as_posix()
    except ValueError:
        raise SystemExit(
            f"[FAIL] ES_CONST: {header} is outside {_REPO}, so the generated file "
            "cannot cite it by a name every machine agrees on.")


#: `ES_CONST(attrs)` then a `constexpr` integer on the following line(s).
_DECL = re.compile(
    r'ES_CONST\(([^)]*)\)\s*'
    r'(?:static\s+|inline\s+)?constexpr\s+\w[\w:]*\s+(\w+)\s*=\s*'
    r'(0[xX][0-9a-fA-F]+|-?\d+)\s*;')

#: `ES_CONST` with something that is not a constexpr integer behind it.
_ORPHAN = re.compile(r'ES_CONST\([^)]*\)')


def parse_constants(roots: List[Path]) -> List[Constant]:
    """Every `ES_CONST` under `roots`, sorted so the output is reproducible."""
    out: List[Constant] = []
    for root in roots:
        if not root.is_dir():
            raise SystemExit(f"[FAIL] ES_CONST scan: no such directory: {root}")
        for header in sorted(root.rglob('*.hpp')):
            raw = header.read_text(encoding='utf-8', errors='replace')
            if 'ES_CONST' not in raw:
                continue
            # Comments out first, or the macro's own @code example is read as a
            # declaration and Reflection.hpp starts exporting TILE_ID_MASK.
            text = CppParser._strip_comments(raw)
            found = list(_DECL.finditer(text))
            # A marker the pattern could not read is a constant that silently
            # would NOT be generated — the exact drift this exists to stop.
            if len(found) != len(_ORPHAN.findall(text)) - _macro_definitions(text):
                raise SystemExit(
                    f"[FAIL] ES_CONST in {header} that is not followed by a "
                    "`constexpr <int type> NAME = <integer>;`. Only integers cross.")
            for m in found:
                attrs = _attrs(m.group(1))
                out.append(Constant(
                    cpp_name=m.group(2),
                    ts_name=attrs.get('ts', m.group(2)),
                    value=int(m.group(3), 0),
                    hex='hex' in attrs,
                    header=_cite(header),
                ))
    _refuse_duplicates(out)
    return sorted(out, key=lambda c: c.ts_name)


def _macro_definitions(text: str) -> int:
    """`#define ES_CONST(...)` in Reflection.hpp is not a declaration."""
    return len(re.findall(r'#\s*define\s+ES_CONST', text))


def _attrs(raw: str) -> Dict[str, str]:
    attrs: Dict[str, str] = {}
    for part in (p.strip() for p in raw.split(',')):
        if not part:
            continue
        key, _, value = part.partition('=')
        attrs[key.strip()] = value.strip()
    return attrs


def _refuse_duplicates(consts: List[Constant]) -> None:
    """Two headers claiming one TS name would make the generated file depend on
    scan order — and one of the two would be silently dropped."""
    seen: Dict[str, Constant] = {}
    for c in consts:
        prior = seen.get(c.ts_name)
        if prior is not None:
            raise SystemExit(
                f"[FAIL] ES_CONST: '{c.ts_name}' declared in both {prior.header} "
                f"and {c.header}. A boundary constant has one author.")
        seen[c.ts_name] = c


def canonical(consts: List[Constant]) -> List[str]:
    """What the ABI hash takes of them: name and value, in a stable order."""
    return [f'CONST {c.ts_name}={c.value}' for c in consts]


def generate_ts(consts: List[Constant]) -> str:
    """The TS half. No imports: this is a leaf every realm can reach."""
    lines = [
        '// SPDX-License-Identifier: Apache-2.0',
        '// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team',
        '/**',
        ' * @file    constants.generated.ts',
        ' * @brief   Boundary constants marked `ES_CONST` in the C++ headers',
        ' * @details Generated by EHT - DO NOT EDIT',
        ' *',
        ' * Hand-copied, these do not fail when they drift — a wrong mask decodes a',
        ' * stored cell into a different tile. They are in the ABI layout hash, so a',
        ' * WASM binary and an SDK bundle built from different values refuse each',
        ' * other rather than disagreeing quietly.',
        ' */',
        '',
    ]
    for c in consts:
        value = f'0x{c.value:x}' if c.hex else str(c.value)
        lines.append(f'/** C++ `{c.cpp_name}` in `{c.header}`. */')
        lines.append(f'export const {c.ts_name} = {value};')
        lines.append('')
    return '\n'.join(lines)
