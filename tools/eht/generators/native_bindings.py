"""Native binding generator — the native sibling of the embind generator.

Emits, per ES_COMPONENT, script-callable member getters/setters for reflected
strings, scalars, vectors and enums, plus compiler-validated zero-copy buffers and an
``esn_register()`` that installs them as script globals. It consumes the SAME
parsed reflection (data.Component) as EmbindGenerator, so the web (embind) and
native binding surfaces are generated from one source and cannot drift. The
emitted code is written against the host's engine surface (esjs.hpp), so it is
the same whichever JS engine the host embeds.

Opt-in: only emitted when ``python -m eht --native-output PATH`` is given, so the
default EHT run (and the committed *.generated.* files it produces) is unchanged.
The generated TU relies on a host-provided shim header (default ``esn_shim.hpp``)
for the ``esn_*`` readers, the entity lookup, and the component includes.
"""

from typing import List
from ..data import Component, Enum, READ_HOOKS, WRITE_HOOKS
from ..type_system import TypeSystem
from .ptr_layout import PtrLayoutGenerator

# Numeric primitives written straight through (via a double), by cleaned type.
_FLOAT = {'f32', 'f64', 'float', 'double'}
_INT = {'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
        'int', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'size_t', 'char'}
# Float vector arities used by list element bindings.
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
        self.layouts = {l['name']: l for l in PtrLayoutGenerator(self.components, enums).layouts}

    def _members(self, ct):
        if ct in self.types.CUSTOM_STRUCTS:
            return [m for m, _ in self.types.CUSTOM_STRUCTS[ct]]
        if ct in self.types.GLM_TYPES:
            return ['x', 'y', 'z', 'w'][:{'glm::vec2': 2, 'glm::uvec2': 2,
                                       'glm::vec3': 3}.get(ct, 4)]
        return []

    def _read_field(self, prop):
        ct = self.types.clean_type(prop.cpp_type)
        n = prop.name
        members = self._members(ct)
        if members:
            lines = ['    { const esjs::Val v = esjs::object();']
            lines += [f'      esjs::set(v, "{m}", esjs::number(c->{n}.{m}));'
                      for m in members]
            return lines + [f'      esjs::set(o, "{n}", v); }}']
        if ct == 'std::string':
            value = f'esjs::string(std::string_view(c->{n}.data(), c->{n}.size()))'
        elif ct == 'bool':
            value = f'esjs::boolean(c->{n})'
        elif self.types.is_handle(ct):
            value = f'esjs::number(c->{n}.id())'
        elif ct == 'Entity':
            value = f'esjs::number(static_cast<esengine::u32>(c->{n}))'
        elif ct in _FLOAT | _INT or self.types.is_enum(ct):
            value = f'esjs::number(static_cast<double>(c->{n}))'
        else:
            return []
        return [f'    esjs::set(o, "{n}", {value});']

    def _field(self, prop) -> str:
        t = prop.cpp_type
        n = prop.name
        ct = self.types.clean_type(t)
        if ct == 'std::string':
            return (f'    {{ const esjs::Val v = esjs::get(o, "{n}"); '
                    'if (!esjs::isUndefined(v)) { const esjs::Utf8 s(v); '
                    f'if (s) c.{n}.assign(s.c_str(), s.size()); }} }}')
        if self._members(ct):
            lines = [f'    {{ const esjs::Val v = esjs::get(o, "{n}");']
            lines.append('      if (esjs::isObject(v)) {')
            for i, m in enumerate(self._members(ct)):
                lines.append(f'      {{ double x; if (esn_getnum(v, esjs::isArray(v) ? "{i}" : "{m}", &x)) '
                             f'c.{n}.{m} = static_cast<decltype(c.{n}.{m})>(x); }}')
            return '\n'.join(lines + ['      } }'])
        if ct == 'bool':
            return f'    {{ int _b; if (esn_getbool(o, "{n}", &_b)) c.{n} = _b != 0; }}'
        if self.types.is_enum(t) or ct in _INT or ct == 'Entity':
            return (f'    {{ double _v; if (esn_getnum(o, "{n}", &_v)) '
                    f'c.{n} = static_cast<decltype(c.{n})>(static_cast<long long>(_v)); }}')
        if ct in _FLOAT:
            return (f'    {{ double _v; if (esn_getnum(o, "{n}", &_v)) '
                    f'c.{n} = static_cast<decltype(c.{n})>(_v); }}')
        if self.types.is_handle(t):
            # A resource handle (e.g. TextureHandle): the script passes the packed
            # id returned by a resource binding (es_createTexture); reconstruct it.
            return (f'    {{ double _v; if (esn_getnum(o, "{n}", &_v)) '
                    f'c.{n} = decltype(c.{n})(static_cast<esengine::u32>(static_cast<long long>(_v))); }}')
        if self.types.is_struct_vector(ct):
            return f'    // {n}: a list, carried by its own _set/_get pair'
        return f'    // skip {n}: {t} (entity / vector / struct — needs a bespoke binding)'


    def _list_fields(self, comp):
        """(property, [member names]) for every field carried as a JS array.

        A variable-length field has no place in the zero-copy component buffer the
        ptr accessors write through — its storage is a pointer — so it crosses as
        its own pair of bindings. Two entity lists predate this and keep the
        hand-written pair the registry wires them by (TypeSystem.HAND_WIRED_ENTITY_LISTS).
        """
        out = []
        for prop in comp.properties:
            t = self.types.clean_type(prop.cpp_type)
            # A list of plain numbers crosses as a list of numbers: no members to
            # walk, which is what the empty list below means downstream.
            if t in self.types.VECTOR_TYPES and ('entity_ref' not in prop.annotations
                                                 or comp.name not in self.types.HAND_WIRED_ENTITY_LISTS):
                out.append((prop, []))
                continue
            if not self.types.is_struct_vector(t):
                continue
            elem = self.types.vector_elem(t)
            members = ([m for m, _ in self.types.CUSTOM_STRUCTS[elem]]
                       if elem in self.types.CUSTOM_STRUCTS
                       else ['x', 'y', 'z', 'w'][:_GLM_ARITY[elem]])
            out.append((prop, members))
        return out

    def _list_binding(self, comp, full, prop, members) -> List[str]:
        get_name = f'es_{comp.name}_{prop.name}_get'
        set_name = f'es_{comp.name}_{prop.name}_set'
        out = [f'static esjs::Val {get_name}(const esjs::Args& a) {{',
               '    const esjs::Val arr = esjs::array();',
               '    if (a.size() < 1) return arr;',
               f'    const auto* c = esn_reg().tryGet<{full}>(esn_entity(a[0]));',
               '    if (!c) return arr;',
               '    uint32_t i = 0;',
               f'    for (const auto& v : c->{prop.name}) {{']
        if members:
            out.append('        const esjs::Val o = esjs::object();')
            for m in members:
                out.append(f'        esjs::set(o, "{m}", esjs::number(v.{m}));')
            out.append('        esjs::setAt(arr, i++, o);')
        else:
            # An Entity converts to a number through its id, as the embind side writes it.
            wide = 'static_cast<esengine::u32>(v)' if 'entity_ref' in prop.annotations else 'v'
            out.append(f'        esjs::setAt(arr, i++, esjs::number({wide}));')
        out += ['    }',
                '    return arr;',
                '}',
                f'static esjs::Val {set_name}(const esjs::Args& a) {{',
                '    if (a.size() < 2) return esjs::undefined();',
                f'    auto& c = esn_reg().getOrEmplace<{full}>(esn_entity(a[0]));',
                f'    c.{prop.name}.clear();',
                '    const uint32_t len = esjs::lengthOf(a[1]);',
                f'    c.{prop.name}.reserve(len);',
                '    for (uint32_t i = 0; i < len; ++i) {',
                '        esjs::Scope scope;',
                '        const esjs::Val e = esjs::getAt(a[1], i);',
                f'        decltype(c.{prop.name})::value_type v{{}};']
        if members:
            for m in members:
                out.append(f'        v.{m} = static_cast<decltype(v.{m})>(esjs::toNumber(esjs::get(e, "{m}")));')
        else:
            if 'entity_ref' in prop.annotations:
                out.append('        v = decltype(v)(static_cast<esengine::u32>(esjs::toNumber(e)));')
            else:
                out.append('        v = static_cast<decltype(v)>(esjs::toNumber(e));')
        out += [f'        c.{prop.name}.push_back(v);',
                '    }',
                '    return esjs::undefined();',
                '}']
        return out

    def _component(self, comp: Component) -> List[str]:
        full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
        # Per-field setter: es_set_<Component>(entityId, obj).
        out = [f'static esjs::Val es_set_{comp.name}(const esjs::Args& a) {{',
               '    if (a.size() < 2) return esjs::undefined();',
               '    esengine::Entity e = esn_entity(a[0]);',
               f'    auto& c = esn_reg().getOrEmplace<{full}>(e);',
               '    const esjs::Val o = a[1];',
               '    (void)c; (void)o;']
        for prop in comp.properties:
            if 'readonly' not in prop.annotations:
                out.append(self._field(prop))
        if comp.name in WRITE_HOOKS:
            out.append(f'    {WRITE_HOOKS[comp.name]}')
        out.append('    return esjs::undefined();')
        out.append('}')
        out += [f'static esjs::Val es_get_{comp.name}(const esjs::Args& a) {{',
                '    const esjs::Val o = esjs::object();',
                '    if (a.size() < 1) return o;',
                f'    auto* c = esn_reg().tryGet<{full}>(esn_entity(a[0]));',
                '    if (!c) return o;']
        read_hook = READ_HOOKS.get(comp.name)
        if read_hook:
            out.append(f'    c->{read_hook}();')
        for prop in comp.properties:
            out.extend(self._read_field(prop))
        out += ['    return o;', '}']
        # The buffer implementation is registered below only if the native
        # compiler proves trivial ownership and the actual wasm accessor offsets.
        # getOrEmplace so a first write (component add) also creates the component.
        out.append(f'static esjs::Val es_{comp.name}_buffer(const esjs::Args& a) {{')
        out.append('    if (a.size() < 1) return esjs::undefined();')
        out.append('    esengine::Entity e = esn_entity(a[0]);')
        out.append(f'    auto& c = esn_reg().getOrEmplace<{full}>(e);')
        read_hook = READ_HOOKS.get(comp.name)
        if read_hook:
            out.append(f'    c.{read_hook}();   // lazily derived fields, see READ_HOOKS')
        out.append(f'    return esn_arraybuffer(&c, sizeof({full}));')
        out.append('}')
        # Lifecycle: the native siblings of the embind Registry's has/remove. With
        # the buffer (getOrEmplace = add) + ptrAccessors (fields), these complete the
        # component API the SDK's BuiltinBridge drives (getBuiltinMethods).
        out.append(f'static esjs::Val es_{comp.name}_has(const esjs::Args& a) {{')
        out.append('    if (a.size() < 1) return esjs::undefined();')
        out.append('    esengine::Entity e = esn_entity(a[0]);')
        out.append(f'    return esjs::boolean(esn_reg().has<{full}>(e));')
        out.append('}')
        out.append(f'static esjs::Val es_{comp.name}_remove(const esjs::Args& a) {{')
        out.append('    if (a.size() < 1) return esjs::undefined();')
        out.append('    esengine::Entity e = esn_entity(a[0]);')
        out.append(f'    if (esn_reg().has<{full}>(e)) esn_reg().remove<{full}>(e);')
        out.append('    return esjs::undefined();')
        out.append('}')
        for prop, members in self._list_fields(comp):
            out.extend(self._list_binding(comp, full, prop, members))
        out.append('')
        return out

    def generate(self) -> str:
        lines = [
            '// Auto-generated by EHT (native_bindings) — DO NOT EDIT.',
            '// Native sibling of WebBindings.generated.cpp — one reflection source.',
            f'#include "{self.shim_header}"',
            '#include <type_traits>',
            '#include <cstddef>',
            '#include <string>',
            '',
        ]
        components = sorted(self.components, key=lambda c: c.name)
        if any(c.name in WRITE_HOOKS for c in components):
            lines.append('#include "esengine/ecs/TransformSystem.hpp"')
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
        lines.extend([
            'static esjs::Val es_getBuiltinComponentNames(const esjs::Args& a) {',
            '    if (a.size() < 1) return esjs::undefined();',
            '    const auto e = esn_entity(a[0]);',
            '    std::string names;',
        ])
        for comp in components:
            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            lines.append(f'    if (esn_reg().has<{full}>(e)) {{ if (!names.empty()) names += "|"; names += "{comp.name}"; }}')
        lines.extend([
            '    return esjs::string(names);',
            '}', '',
        ])
        lines.extend([
            'static esjs::Val es_componentTypeId(const esjs::Args& a) {',
            '    if (a.size() < 1) return esjs::int32(-1);',
            '    const std::string name = esjs::toString(a[0]);',
        ])
        for comp in components:
            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            lines.append(f'    if (name == "{comp.name}") return esjs::int64(esengine::componentTypeId<{full}>());')
        lines.extend(['    return esjs::int32(-1);', '}', ''])
        lines.append('void esn_register(esjs::Val global) {')
        lines.append('    esjs::setFunction(global, "es_componentTypeId", es_componentTypeId, 1);')
        lines.append('    esjs::setFunction(global, "es_getBuiltinComponentNames", es_getBuiltinComponentNames, 1);')
        for comp in components:
            setter = f'es_set_{comp.name}'
            buffer = f'es_{comp.name}_buffer'
            has = f'es_{comp.name}_has'
            remove = f'es_{comp.name}_remove'
            lines.append(f'    esjs::setFunction(global, "{setter}", {setter}, 2);')
            getter = f'es_get_{comp.name}'
            lines.append(f'    esjs::setFunction(global, "{getter}", {getter}, 1);')
            # Expose the raw buffer ONLY when this compiler proves every accessed
            # offset matches wasm32 and no owned string/vector can be overwritten.
            full = f'{comp.namespace}::{comp.name}' if comp.namespace else comp.name
            layout = self.layouts.get(comp.name)
            if layout:
                checks = [f'std::is_standard_layout_v<{full}>',
                          f'std::is_trivially_copyable_v<{full}>']
                checks += [f'offsetof({full}, {f["name"]}) == {f["offset"]}'
                           for f in layout['fields']]
                for f in layout['fields']:
                    checks += [f'offsetof(decltype({full}::{f["name"]}), {m["name"]}) == {m["offset"]}'
                               for m in f.get('members', [])]
                lines.append(f'    if constexpr ({" && ".join(checks)}) {{')
                lines.append(f'        esjs::setFunction(global, "{buffer}", {buffer}, 1);')
                lines.append('    }')
            lines.append(f'    esjs::setFunction(global, "{has}", {has}, 1);')
            lines.append(f'    esjs::setFunction(global, "{remove}", {remove}, 1);')
            for prop, _members in self._list_fields(comp):
                for fn, arity in ((f'es_{comp.name}_{prop.name}_get', 1),
                                  (f'es_{comp.name}_{prop.name}_set', 2)):
                    lines.append(f'    esjs::setFunction(global, "{fn}", {fn}, {arity});')
        lines.append('}')
        lines.append('')
        return '\n'.join(lines)
