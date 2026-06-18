"""ABI layout hashing — single source of truth for the C++/TS boundary contract.

The hash is computed ONCE here (in Python) from the parsed component schema and
the computed pointer layouts, then emitted verbatim into BOTH the C++ binding
(`getAbiLayoutHash()`) and the TS bundle (`ABI_LAYOUT_HASH`). At `connect()` the
SDK compares the two: a mismatch means the loaded WASM binary and the shipped SDK
were generated from different schemas, so the pointer offsets the SDK uses would
read the wrong bytes. Refusing to run is the only safe response.

This is the runtime half of the keystone. The compile-time half is the generated
`static_assert(offsetof(...))` block, which proves EHT's computed offsets equal
the real compiler layout. Together: TS offset == EHT offset == compiler offset,
and the loaded WASM's schema == the SDK's schema.
"""

import hashlib
from typing import Dict, List

from .data import Component, Enum


def _canonical(components: List[Component], enums: List[Enum],
               layouts: List[Dict]) -> str:
    """Build an order-independent canonical description of the boundary ABI.

    Components/enums/layouts are sorted by name so the hash is stable regardless
    of filesystem glob order (which is not guaranteed across machines).
    """
    parts: List[str] = []

    for enum in sorted(enums, key=lambda e: e.name):
        vals = ','.join(enum.values)
        parts.append(f'ENUM {enum.name}:{enum.underlying_type}={vals}')

    for comp in sorted(components, key=lambda c: c.name):
        fields = ';'.join(f'{p.name}:{p.cpp_type}' for p in comp.properties)
        parts.append(f'COMP {comp.name}|{fields}')

    for layout in sorted(layouts, key=lambda l: l['name']):
        flds = ';'.join(
            f"{f['name']}:{f['type']}@{f['offset']}" for f in layout['fields']
        )
        parts.append(f"PTR {layout['name']}|{flds}")

    return '\n'.join(parts)


def compute_abi_hash(components: List[Component], enums: List[Enum],
                     layouts: List[Dict]) -> str:
    """Return a stable 16-hex-char digest of the boundary ABI."""
    canonical = _canonical(components, enums, layouts)
    return hashlib.sha1(canonical.encode('utf-8')).hexdigest()[:16]
