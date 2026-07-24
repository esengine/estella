"""Native (QuickJS) binding generator — the native sibling of the embind generator.

Emits, per ES_COMPONENT, a QuickJS-callable ``es_set_<Component>(entityId, obj)``
that writes the reflected scalar / vec / bool / enum fields, plus an
``esn_register()`` that installs them as script globals. It consumes the SAME
parsed reflection (data.Component) as EmbindGenerator, so the web (embind) and
native (QuickJS) binding surfaces are generated from one source and cannot drift.

Opt-in: only emitted when ``python -m eht --native-output PATH`` is given, so the
default EHT run (and the committed *.generated.* files it produces) is unchanged.
The generated TU relies on a host-provided shim header (default ``esn_shim.hpp``)
for the ``esn_*`` readers, the entity lookup, and the component includes.
"""

from typing import List
from ..data import Component, Enum
from ..type_system import TypeSystem

# Numeric primitives written straight through (via a double), by cleaned type.
_FLOAT = {'f32', 'f64', 'float', 'double'}
_INT = {'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
        'int', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'size_t', 'char'}
# glm vector arities the reader marshals (float lanes). quat/uvec2 skipped:
# quaternion storage order is fragile to hand-write, uvec2 is unsigned.
_GLM_ARITY = {'glm::vec2': 2, 'glm::vec3': 3, 'glm::vec4': 4}


class NativeBindingsGenerator:
    def __init__(self, components: List[Component], enums: List[Enum],
                 shim_header: str = 'esn_shim.hpp', only=None):
        # ``only`` (a set of component names) narrows the emitted surface so a host
        # that includes only some component headers still compiles; None = all.
        self.components = [c for c in components if only is None or c.name in only]
        self.enums = enums
        self.types = TypeSystem(enums)
        self.shim_header = shim_header

    def _field(self, prop) -> str:
        t = prop.cpp_type
        n = prop.name
        ct = self.types.clean_type(t)
        if ct in _GLM_ARITY:
            return f'    esn_getvec(ctx, o, "{n}", &c.{n}.x, {_GLM_ARITY[ct]});'
        if ct == 'bool':
            return f'    {{ int _b; if (esn_getbool(ctx, o, "{n}", &_b)) c.{n} = _b != 0; }}'
        if self.types.is_enum(t) or ct in _INT:
            return (f'    {{ double _v; if (esn_getnum(ctx, o, "{n}", &_v)) '
                    f'c.{n} = static_cast<decltype(c.{n})>(static_cast<long long>(_v)); }}')
        if ct in _FLOAT:
            return (f'    {{ double _v; if (esn_getnum(ctx, o, "{n}", &_v)) '
                    f'c.{n} = static_cast<decltype(c.{n})>(_v); }}')
        if self.types.is_handle(t):
            # A resource handle (e.g. TextureHandle): the script passes the packed
            # id returned by a resource binding (es_createTexture); reconstruct it.
            return (f'    {{ double _v; if (esn_getnum(ctx, o, "{n}", &_v)) '
                    f'c.{n} = decltype(c.{n})(static_cast<esengine::u32>(static_cast<long long>(_v))); }}')
        return f'    // skip {n}: {t} (entity / vector / struct — needs a bespoke binding)'

    def _component(self, comp: Component) -> List[str]:
        full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
        # Per-field setter: es_set_<Component>(entityId, obj).
        out = [f'static JSValue es_set_{comp.name}(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{',
               '    if (argc < 2) return JS_UNDEFINED;',
               '    esengine::Entity e = esn_entity(ctx, argv[0]);',
               f'    auto& c = esn_reg().getOrEmplace<{full}>(e);',
               '    JSValueConst o = argv[1];',
               '    (void)c; (void)o;']
        for prop in comp.properties:
            out.append(self._field(prop))
        out.append('    return JS_UNDEFINED;')
        out.append('}')
        # Fast path: es_<Component>_buffer(entityId) -> a zero-copy ArrayBuffer over
        # the native component, which the shared generated ptrAccessors write. Same
        # POD layout as wasm32, so ptrAccessors.generated.ts works unchanged.
        # getOrEmplace so a first write (component add) also creates the component.
        out.append(f'static JSValue es_{comp.name}_buffer(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        out.append('    if (argc < 1) return JS_UNDEFINED;')
        out.append('    esengine::Entity e = esn_entity(ctx, argv[0]);')
        out.append(f'    auto& c = esn_reg().getOrEmplace<{full}>(e);')
        out.append(f'    return esn_arraybuffer(ctx, &c, sizeof({full}));')
        out.append('}')
        # Lifecycle: the native siblings of the embind Registry's has/remove. With
        # the buffer (getOrEmplace = add) + ptrAccessors (fields), these complete the
        # component API the SDK's BuiltinBridge drives (getBuiltinMethods).
        out.append(f'static JSValue es_{comp.name}_has(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        out.append('    if (argc < 1) return JS_UNDEFINED;')
        out.append('    esengine::Entity e = esn_entity(ctx, argv[0]);')
        out.append(f'    return JS_NewBool(ctx, esn_reg().has<{full}>(e));')
        out.append('}')
        out.append(f'static JSValue es_{comp.name}_remove(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        out.append('    if (argc < 1) return JS_UNDEFINED;')
        out.append('    esengine::Entity e = esn_entity(ctx, argv[0]);')
        out.append(f'    if (esn_reg().has<{full}>(e)) esn_reg().remove<{full}>(e);')
        out.append('    return JS_UNDEFINED;')
        out.append('}')
        out.append('')
        return out

    def generate(self) -> str:
        lines = [
            '// Auto-generated by EHT (native_bindings) — DO NOT EDIT.',
            '// Native QuickJS sibling of WebBindings.generated.cpp — one reflection source.',
            f'#include "{self.shim_header}"',
            '',
        ]
        components = sorted(self.components, key=lambda c: c.name)
        # Self-include each bound component's header (relative to src/), so the TU
        # needs only the shim for the esn_* plumbing — deduped (some components
        # share a header, e.g. the collider family).
        seen = set()
        for comp in components:
            hp = comp.header_path.replace('\\', '/')
            if hp.startswith('src/'):
                hp = hp[len('src/'):]
            if hp and hp not in seen:
                seen.add(hp)
                lines.append(f'#include "{hp}"')
        if seen:
            lines.append('')
        for comp in components:
            lines.extend(self._component(comp))
        lines.append('void esn_register(JSContext* ctx, JSValue global) {')
        for comp in components:
            setter = f'es_set_{comp.name}'
            buffer = f'es_{comp.name}_buffer'
            has = f'es_{comp.name}_has'
            remove = f'es_{comp.name}_remove'
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{setter}", '
                         f'JS_NewCFunction(ctx, {setter}, "{setter}", 2));')
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{buffer}", '
                         f'JS_NewCFunction(ctx, {buffer}, "{buffer}", 1));')
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{has}", '
                         f'JS_NewCFunction(ctx, {has}, "{has}", 1));')
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{remove}", '
                         f'JS_NewCFunction(ctx, {remove}, "{remove}", 1));')
        lines.append('}')
        lines.append('')
        return '\n'.join(lines)
