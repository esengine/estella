"""Native (QuickJS) wrappers for the engine's binding ENTRY POINTS.

The component half of the boundary has been generated from one reflection source
for a while (``native_bindings.py`` + ``embind.py``). The function half was not:
every entry point the SDK calls — ``renderer_begin``, ``renderer_submitAll``,
``uiLayout_update``, … — was declared once in C++ and then bound BY HAND, once in
embind for the web and once more in the native host. Which is why anything JS
drives (the frame, the UI layout, tilemaps, particles) worked on the web and had
to be rewritten in C++ to work on a device.

This generator removes the second hand-written copy. It reads the declarations in
``bindings/*.hpp`` — the same ones embind registers — and emits a QuickJS wrapper
per function that marshals the arguments and calls it. The BODY is shared: the
binding TU itself compiles natively (see cmake/ESEngineSources.cmake), so both
platforms run the same implementation; only the registration differs.

The mapping is small because the declarations are:

  ``ecs::Registry&``    the host has exactly one registry, so it is implicit and
                        consumes no JS argument
  scalars               u32/i32/f32/f64/bool/int/float/double
  ``uintptr_t`` ptr     a JS ArrayBuffer / typed array; the wrapper copies the
                        bytes and passes a real pointer (the same BoundarySpan
                        validation runs inside the binding)
  returns               void / integer / float / bool

Anything else — ``emscripten::val`` results, ``std::string``, typed pointers — is
SKIPPED and reported, never silently dropped: the skip list is what tells you
which entry points still need a hand-written binding.
"""

import re
from typing import List, NamedTuple, Optional, Tuple

# What the wrapper can marshal, and how each maps to a QuickJS read.
_INT_TYPES = {'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
              'int', 'int32_t', 'uint32_t', 'size_t', 'long'}
_FLOAT_TYPES = {'f32', 'f64', 'float', 'double'}
_BOOL_TYPES = {'bool'}
_VOID = 'void'

# `void name(args);` on one or more lines, inside the header's namespace.
_DECL = re.compile(
    r'^(?P<ret>[A-Za-z_][\w:]*(?:\s*\*)?)\s+(?P<name>[A-Za-z_]\w*)\s*\((?P<args>[^;{]*)\)\s*;',
    re.MULTILINE | re.DOTALL,
)


class Param(NamedTuple):
    cpp_type: str
    name: str


class Function(NamedTuple):
    name: str
    ret: str
    params: List[Param]
    # The feature gates the declaration sits under (ES_ENABLE_SPINE, …). The
    # wrapper carries them verbatim, so the generated TU tracks whatever the
    # build enables instead of assuming a fixed feature set.
    guards: Tuple[str, ...] = ()


class Skipped(NamedTuple):
    name: str
    reason: str


def _clean(t: str) -> str:
    return ' '.join(t.replace('const', '').split()).strip()


def parse_header(text: str) -> Tuple[List[Function], List[Skipped]]:
    """Parse the declarations of one bindings header, in file order.

    Declarations under an ``#ifdef __EMSCRIPTEN__`` are skipped outright: those
    are the web-only entry points (they return an ``emscripten::val``), and the
    native build does not even compile them.
    """
    functions: List[Function] = []
    skipped: List[Skipped] = []

    # Walk the header keeping the preprocessor stack: __EMSCRIPTEN__ regions are
    # dropped outright (web-only entry points the native build does not compile),
    # every other gate is remembered and re-emitted around the wrapper.
    kept: List[str] = []
    guards_per_line: List[Tuple[str, ...]] = []
    stack: List[Optional[str]] = []   # None = a web-only region being dropped
    for line in text.splitlines():
        token = line.strip()
        if token.startswith('#ifdef ') or token.startswith('#ifndef ') or token.startswith('#if '):
            name = token.split(None, 1)[1].strip() if ' ' in token else ''
            stack.append(None if name == '__EMSCRIPTEN__' else name)
            continue
        if token.startswith('#endif'):
            if stack:
                stack.pop()
            continue
        if token.startswith('#else') or token.startswith('#elif'):
            # An #else of a dropped region is kept-but-ungated, and vice versa;
            # the bindings headers do not use it, so treat it as a plain region.
            if stack:
                stack[-1] = stack[-1] and f'!{stack[-1]}'
            continue
        if any(g is None for g in stack):
            continue
        kept.append(line)
        guards_per_line.append(tuple(g for g in stack if g))
    body = '\n'.join(kept)

    # Offset → line index, so a match can be attributed to its guard stack.
    line_starts: List[int] = []
    offset = 0
    for line in kept:
        line_starts.append(offset)
        offset += len(line) + 1

    def guards_at(pos: int) -> Tuple[str, ...]:
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= pos:
                lo = mid
            else:
                hi = mid - 1
        return guards_per_line[lo] if guards_per_line else ()

    for match in _DECL.finditer(body):
        ret = _clean(match.group('ret'))
        name = match.group('name')
        if name in {'if', 'for', 'while', 'switch', 'return', 'namespace', 'class'}:
            continue
        params, reason = _parse_params(match.group('args'))
        if reason is None and not _returnable(ret):
            reason = f'returns {ret}'
        if reason is not None:
            skipped.append(Skipped(name, reason))
            continue
        functions.append(Function(name, ret, params, guards_at(match.start())))
    return functions, skipped


def _parse_params(args: str) -> Tuple[List[Param], Optional[str]]:
    params: List[Param] = []
    args = args.strip()
    if not args or args == 'void':
        return params, None
    for raw in args.split(','):
        decl = _clean(raw)
        if not decl:
            continue
        parts = decl.replace('&', ' & ').split()
        # `ecs::Registry &registry` → the host's one registry, no JS argument.
        if parts[0].endswith('Registry') and '&' in decl:
            params.append(Param('ecs::Registry&', parts[-1]))
            continue
        if '&' in decl or '*' in decl:
            return params, f'takes {decl}'
        cpp_type = ' '.join(parts[:-1]) if len(parts) > 1 else parts[0]
        name = parts[-1] if len(parts) > 1 else f'arg{len(params)}'
        cpp_type = _clean(cpp_type)
        if cpp_type not in _INT_TYPES | _FLOAT_TYPES | _BOOL_TYPES | {'uintptr_t'}:
            return params, f'takes {cpp_type}'
        params.append(Param(cpp_type, name))
    return params, None


def _returnable(ret: str) -> bool:
    return ret == _VOID or ret in _INT_TYPES | _FLOAT_TYPES | _BOOL_TYPES


# The engine's short scalar aliases live in namespace esengine; the plain C++
# spellings do not and must stay unqualified.
_PLAIN = {'int', 'long', 'float', 'double', 'bool', 'size_t', 'uintptr_t',
          'int32_t', 'uint32_t'}


def _qualify(cpp_type: str) -> str:
    return cpp_type if cpp_type in _PLAIN else f'esengine::{cpp_type}'


class NativeFunctionsGenerator:
    """Emit ``es_<name>`` QuickJS wrappers for parsed binding declarations."""

    def __init__(self, headers: List[Tuple[str, str]], shim_header: str = 'esn_shim.hpp'):
        # headers: (include path as the generated TU should spell it, source text)
        self.headers = headers
        self.shim_header = shim_header
        self.skipped: List[Skipped] = []
        self.emitted: List[str] = []

    def _wrapper(self, fn: Function) -> List[str]:
        js_params = [p for p in fn.params if p.cpp_type != 'ecs::Registry&']
        out = [f'#ifdef {g}' for g in fn.guards]
        out.append(f'static JSValue es_{fn.name}(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        if js_params:
            out.append(f'    if (argc < {len(js_params)}) return JS_UNDEFINED;')
        out.append('    (void)argc; (void)argv;')

        call_args: List[str] = []
        js_index = 0
        for param in fn.params:
            if param.cpp_type == 'ecs::Registry&':
                call_args.append('esn_reg()')
                continue
            local = f'a{js_index}'
            if param.cpp_type == 'uintptr_t':
                # A JS buffer: copy the bytes, then hand the binding a real pointer.
                # Its own BoundarySpan check still runs on the other side.
                out.append(f'    std::vector<esengine::u8> {local}_bytes;')
                out.append(f'    esn_bytes(ctx, argv[{js_index}], {local}_bytes);')
                out.append(f'    const uintptr_t {local} = {local}_bytes.empty() ? 0 '
                           f': reinterpret_cast<uintptr_t>({local}_bytes.data());')
            elif param.cpp_type in _BOOL_TYPES:
                out.append(f'    const bool {local} = JS_ToBool(ctx, argv[{js_index}]) != 0;')
            elif param.cpp_type in _FLOAT_TYPES:
                cpp = _qualify(param.cpp_type)
                out.append(f'    double {local}_d = 0; JS_ToFloat64(ctx, &{local}_d, argv[{js_index}]);')
                out.append(f'    const {cpp} {local} = static_cast<{cpp}>({local}_d);')
            else:
                cpp = _qualify(param.cpp_type)
                out.append(f'    int64_t {local}_i = 0; JS_ToInt64(ctx, &{local}_i, argv[{js_index}]);')
                out.append(f'    const {cpp} {local} = static_cast<{cpp}>({local}_i);')
            call_args.append(local)
            js_index += 1

        call = f'esengine::{fn.name}({", ".join(call_args)})'
        if fn.ret == _VOID:
            out.append(f'    {call};')
            out.append('    return JS_UNDEFINED;')
        elif fn.ret in _BOOL_TYPES:
            out.append(f'    return JS_NewBool(ctx, {call});')
        elif fn.ret in _FLOAT_TYPES:
            out.append(f'    return JS_NewFloat64(ctx, static_cast<double>({call}));')
        else:
            out.append(f'    return JS_NewInt64(ctx, static_cast<int64_t>({call}));')
        out.append('}')
        out.extend('#endif' for _ in fn.guards)
        out.append('')
        return out

    # ---- the TS half -------------------------------------------------------
    # The same declarations, as the object a native host answers them through.
    # The SDK's plugins call these by the module's own names, so a plugin reaches
    # whichever core is present without knowing which (see ecs/engineApi.ts).
    _TS_RETURN = {'void': 'void', 'bool': 'boolean'}

    @staticmethod
    def _ts_type(cpp: str) -> str:
        if cpp in _BOOL_TYPES:
            return 'boolean'
        if cpp == 'ecs::Registry&':
            return 'unknown'
        return 'number'

    def _ts_signature(self, fn: Function) -> str:
        params = ', '.join(f'{p.name}: {self._ts_type(p.cpp_type)}' for p in fn.params)
        ret = self._TS_RETURN.get(fn.ret, 'number')
        return f'{fn.name}?({params}): {ret};'

    def generate_ts(self) -> str:
        """The native engine API: every generated entry point, callable by the
        name the wasm module exposes it under."""
        functions = [f for f in self._functions() if not any(p.cpp_type == 'uintptr_t' for p in f.params)]
        pointer_taking = [f.name for f in self._functions() if any(p.cpp_type == 'uintptr_t' for p in f.params)]

        lines = [
            '// SPDX-License-Identifier: Apache-2.0',
            '// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team',
            '//',
            '// Auto-generated by EHT (native_functions) — DO NOT EDIT.',
            '//',
            '// The engine entry points a native (embedded-Dawn) host binds, named as the',
            '// wasm module names them — so an SDK plugin calls `api.uiLayout_update(...)`',
            '// and reaches whichever core is present. Generated from the SAME bindings',
            '// headers embind registers from, so the two surfaces cannot drift.',
            '//',
            '// Every member is optional: a core answers what it compiles. Entry points that',
            '// take a heap pointer are NOT here — those need a real backend that decides how',
            '// bytes cross (see RendererBackend), not a name forwarded.',
            '',
            'export interface NativeEngineApi {',
        ]
        for fn in functions:
            lines.append(f'    {self._ts_signature(fn)}')
        lines.append('}')
        lines.append('')
        if pointer_taking:
            lines.append('// Not forwarded (they take a heap pointer): '
                         + ', '.join(sorted(pointer_taking)) + '.')
            lines.append('')
        lines.extend([
            '/** Build the API over a host scope (the QuickJS global object; a plain object',
            ' *  in tests). A name the host did not bind simply stays absent. */',
            'export function createNativeEngineApi(',
            '    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,',
            '): NativeEngineApi {',
            '    const api: Record<string, unknown> = {};',
            '    const bind = (name: string, host: string, dropFirst: boolean): void => {',
            '        const fn = scope[host];',
            '        if (typeof fn !== \'function\') return;',
            '        const call = fn as (...a: unknown[]) => unknown;',
            '        api[name] = dropFirst',
            '            ? (_registry: unknown, ...args: unknown[]) => call(...args)',
            '            : (...args: unknown[]) => call(...args);',
            '    };',
        ])
        for fn in functions:
            takes_registry = any(p.cpp_type == 'ecs::Registry&' for p in fn.params)
            lines.append(f"    bind('{fn.name}', 'es_{fn.name}', {str(takes_registry).lower()});")
        lines.extend([
            '    return api as NativeEngineApi;',
            '}',
            '',
        ])
        return '\n'.join(lines)

    def _functions(self) -> List[Function]:
        out: List[Function] = []
        for _, text in self.headers:
            parsed, _ = parse_header(text)
            out.extend(parsed)
        return sorted(out, key=lambda f: f.name)

    def generate(self) -> str:
        lines = [
            '// Auto-generated by EHT (native_functions) — DO NOT EDIT.',
            '// QuickJS wrappers for the engine binding entry points embind also registers,',
            '// from the SAME declarations. The bodies live in the binding TUs, which this',
            '// build compiles too — one implementation, two registration layers.',
            f'#include "{self.shim_header}"',
            '',
            '#include <cstdint>',
            '#include <vector>',
            '',
        ]
        functions: List[Function] = []
        for include, text in self.headers:
            lines.append(f'#include "{include}"')
            parsed, skipped = parse_header(text)
            functions.extend(parsed)
            self.skipped.extend(skipped)
        lines.append('')

        for fn in sorted(functions, key=lambda f: f.name):
            self.emitted.append(fn.name)
            lines.extend(self._wrapper(fn))

        lines.append('void esn_register_functions(JSContext* ctx, JSValue global) {')
        for fn in sorted(functions, key=lambda f: f.name):
            js_arity = len([p for p in fn.params if p.cpp_type != 'ecs::Registry&'])
            lines.extend(f'#ifdef {g}' for g in fn.guards)
            lines.append(f'    JS_SetPropertyStr(ctx, global, "es_{fn.name}", '
                         f'JS_NewCFunction(ctx, es_{fn.name}, "es_{fn.name}", {js_arity}));')
            lines.extend('#endif' for _ in fn.guards)
        lines.append('}')
        lines.append('')
        return '\n'.join(lines)
