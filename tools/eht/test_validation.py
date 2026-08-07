"""Plain-python tests for ES_PROPERTY / ES_COMPONENT annotation validation.

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
ES_COMPONENT({comp})
struct C {{
{body}
}};
}}
"""

_failures = 0


def _parse(body: str, comp: str = '') -> CppParser:
    p = CppParser()
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / 'C.hpp'
        f.write_text(HEADER.format(body=body, comp=comp), encoding='utf-8')
        p.parse_file(f)
    return p


def expect(name: str, body: str, *, errors: int, warnings_at_least: int = 0, comp: str = '') -> None:
    global _failures
    p = _parse(body, comp)
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

# ── editor_default: a braced initializer's commas must not split the token ──
quoted_ok('editor_default braced vector stays one token',
          'ES_PROPERTY(animatable, editor_default={100, 100})\n    glm::vec2 size{1.0f, 1.0f};',
          'size', 'editor_default', '{100, 100}')
quoted_ok('editor_default enum member',
          'ES_PROPERTY(tooltip="p", editor_default=ProjectionType::Orthographic)\n    ProjectionType p{ProjectionType::Perspective};',
          'p', 'editor_default', 'ProjectionType::Orthographic')
quoted_ok('annotation after a braced editor_default still parses',
          'ES_PROPERTY(editor_default={1, 2}, advanced)\n    glm::vec2 v{0.0f, 0.0f};',
          'v', 'advanced', 'true')


# ── editor_default value validation lives in MetadataGenerator (typed) ──
def editor_default_generates(name: str, body: str, expect_snippet: str) -> None:
    global _failures
    p = _parse(body)
    from eht.generators.metadata import MetadataGenerator
    from eht.data import Enum
    enums = [Enum(name='ProjectionType', namespace='esengine::ecs',
                  values=['Perspective', 'Orthographic'])]
    try:
        out = MetadataGenerator(p.components, enums).generate()
    except ValueError as e:
        out = f'VALUEERROR: {e}'
    if expect_snippet not in out:
        _failures += 1
        print(f"FAIL  {name}")
        print(f"        {expect_snippet!r} not found in output")
    else:
        print(f"ok    {name}")


editor_default_generates('editor_default vec2 emits merged literal',
                         'ES_PROPERTY(editor_default={100, 100})\n    glm::vec2 size{1.0f, 1.0f};',
                         'editorDefaults: {\n            size: { x: 100, y: 100 },')
editor_default_generates('editor_default enum member resolves to its index',
                         'ES_PROPERTY(editor_default=ProjectionType::Orthographic)\n    ProjectionType p{ProjectionType::Perspective};',
                         'editorDefaults: {\n            p: 1,')
editor_default_generates('editor_default bare enum member also resolves',
                         'ES_PROPERTY(editor_default=Orthographic)\n    ProjectionType p{ProjectionType::Perspective};',
                         'editorDefaults: {\n            p: 1,')
editor_default_generates('editor_default unknown enum member is a hard error',
                         'ES_PROPERTY(editor_default=ProjectionType::Sideways)\n    ProjectionType p{ProjectionType::Perspective};',
                         'VALUEERROR')
editor_default_generates('editor_default non-numeric on a float is a hard error',
                         'ES_PROPERTY(editor_default=fast)\n    float s = 1.0f;',
                         'VALUEERROR')
editor_default_generates('editor_default bool accepts true',
                         'ES_PROPERTY(editor_default=true)\n    bool active{false};',
                         'editorDefaults: {\n            active: true,')

# ── Unknown keys stay warnings, not errors (forward-compat) ──
expect('unknown annotation is a warning, not an error',
       'ES_PROPERTY(bogus)\n    float x = 0.0f;',
       errors=0, warnings_at_least=1)
expect('unknown asset type is a warning, not an error',
       'ES_PROPERTY(asset=widget)\n    u32 a = 0;',
       errors=0, warnings_at_least=1)

# ── C++ numeric literals reach TypeScript intact ──
# A default that silently becomes 0 is not a parse failure anyone sees: it ships as
# a camera that renders nothing or a collider that hits nothing.
from eht.field_utils import format_number  # noqa: E402


def number_is(label: str, raw: str, want: str) -> None:
    global _failures
    got = format_number(raw)
    if got == want:
        print(f"  ok  {label}")
    else:
        print(f"FAIL  {label}: format_number({raw!r}) == {got!r}, want {want!r}")
        _failures += 1


print("\n── numeric literals ──")
number_is('hex whose digits are all F', '0xFFFF', '65535')
number_is('hex with an unsigned suffix', '0xFFFFFFFFu', '4294967295')
number_is('hex with leading zeros', '0x0001', '1')
number_is('binary literal', '0b1010', '10')
number_is('unsigned decimal suffix', '64u', '64')
number_is('float suffix', '1.0f', '1')
number_is('fractional value', '0.5f', '0.5')
number_is('negative', '-3', '-3')
number_is('nothing', '', '0')
number_is('not a number', 'junk', '0')

# ── ES_COMPONENT annotations: metadata about the component itself ──
FLAG = 'ES_PROPERTY()\n    bool enabled = true;'

expect('renderable names a bool field',
       FLAG, errors=0, comp='renderable=enabled')
expect('renderable naming no field is an error',
       FLAG, errors=1, comp='renderable=nope')
expect('renderable naming a non-bool field is an error',
       'ES_PROPERTY()\n    float layer = 0.0f;', errors=1, comp='renderable=layer')
expect('bare renderable is an error (the gating field is the point)',
       FLAG, errors=1, comp='renderable')
expect('transient is a flag, not a kv',
       FLAG, errors=0, comp='transient')
expect('both annotations on one component',
       FLAG, errors=0, comp='renderable=enabled, transient')
expect('unknown component annotation is a warning, not an error',
       FLAG, errors=0, warnings_at_least=1, comp='bogus')
expect('no annotations still parses (every component before this change)',
       FLAG, errors=0)


def component_meta_emits(name: str, comp: str, body: str, expect_snippet: str) -> None:
    global _failures
    p = _parse(body, comp)
    from eht.generators.metadata import MetadataGenerator
    out = MetadataGenerator(p.components, []).generate()
    if expect_snippet not in out:
        _failures += 1
        print(f"FAIL  {name}")
        print(f"        {expect_snippet!r} not found in output")
    else:
        print(f"ok    {name}")


component_meta_emits('renderable reaches COMPONENT_META',
                     'renderable=visible', 'ES_PROPERTY()\n    bool visible = true;',
                     "renderableField: 'visible',")
component_meta_emits('transient reaches COMPONENT_META',
                     'transient', FLAG, 'transient: true,')

if _failures:
    print(f"\n{_failures} case(s) failed")
    raise SystemExit(1)
print("\nall cases passed")
