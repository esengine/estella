"""Plain-python tests for ES_PROPERTY annotation validation (RC9-1 P0).

No pytest dependency — run: python3 tools/eht/test_validation.py
Exits non-zero on the first failing case.
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # put tools/ on path
from eht.parser import CppParser  # noqa: E402

HEADER = """
namespace esengine::ecs {{
ES_COMPONENT()
struct C {{
{body}
}};
}}
"""

_failures = 0


def _parse(body: str) -> CppParser:
    p = CppParser()
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'C.hpp'
        f.write_text(HEADER.format(body=body), encoding='utf-8')
        p.parse_file(f)
    return p


def expect(name: str, body: str, *, errors: int, warnings_at_least: int = 0) -> None:
    global _failures
    p = _parse(body)
    problems = []
    if len(p.errors) != errors:
        problems.append(f"errors: got {len(p.errors)} want {errors} -> {p.errors}")
    if len(p.warnings) < warnings_at_least:
        problems.append(f"warnings: got {len(p.warnings)} want >= {warnings_at_least} -> {p.warnings}")
    if problems:
        _failures += 1
        print(f"FAIL  {name}")
        for pr in problems:
            print(f"        {pr}")
    else:
        print(f"ok    {name}")


# ── Positives: well-formed metadata produces no errors ──
expect('full presentation metadata',
       'ES_PROPERTY(min=0, max=10, slider, unit="x", tooltip="hi", category="Grp", advanced)\n    float x = 0.0f;',
       errors=0)
expect('anim_flag is a known kv annotation',
       'ES_PROPERTY(animatable, anim_flag=ANIM_POS_X)\n    float y = 0.0f;',
       errors=0)
expect('invalidates names a sibling (order-independent)',
       'ES_PROPERTY(invalidates=foo)\n    std::string s{};\n    ES_PROPERTY()\n    bool foo = false;',
       errors=0)
expect('existing asset annotation still clean',
       'ES_PROPERTY(asset=texture)\n    u32 tex = 0;',
       errors=0)
expect('skip_serialize / replicated flags accepted',
       'ES_PROPERTY(skip_serialize, replicated)\n    float z = 0.0f;',
       errors=0)

# ── Negatives: malformed known metadata is a hard error ──
expect('non-numeric min is an error',
       'ES_PROPERTY(min=abc)\n    float x = 0.0f;',
       errors=1)
expect('slider without a range is an error',
       'ES_PROPERTY(slider)\n    float x = 0.0f;',
       errors=1)
expect('slider with only min is an error',
       'ES_PROPERTY(slider, min=0)\n    float x = 0.0f;',
       errors=1)
expect('invalidates naming no field is an error',
       'ES_PROPERTY(invalidates=nope)\n    std::string s{};',
       errors=1)

# ── Quoted values carry commas and parens (tooltips) without breaking tokenizing ──
def quoted_ok(name: str, body: str, field: str, key: str, expected: str) -> None:
    global _failures
    p = _parse(body)
    got = None
    for c in p.components:
        for pr in c.properties:
            if pr.name == field:
                got = pr.annotations.get(key)
    if len(p.errors) != 0 or got != expected:
        _failures += 1
        print(f"FAIL  {name}")
        print(f"        errors={p.errors} annotations.{key}={got!r} want {expected!r}")
    else:
        print(f"ok    {name}")


quoted_ok('tooltip with commas + parens stays one token',
          'ES_PROPERTY(min=0, tooltip="Falloff reach (Point / Spot), in units.")\n    float radius = 0.0f;',
          'radius', 'tooltip', 'Falloff reach (Point / Spot), in units.')
quoted_ok('quotes are stripped from the value',
          'ES_PROPERTY(unit="deg")\n    float a = 0.0f;',
          'a', 'unit', 'deg')

# ── Unknown keys stay warnings, not errors (forward-compat) ──
expect('unknown annotation is a warning, not an error',
       'ES_PROPERTY(bogus)\n    float x = 0.0f;',
       errors=0, warnings_at_least=1)
expect('unknown asset type is a warning, not an error',
       'ES_PROPERTY(asset=widget)\n    u32 a = 0;',
       errors=0, warnings_at_least=1)

if _failures:
    print(f"\n{_failures} case(s) failed")
    raise SystemExit(1)
print("\nall cases passed")
