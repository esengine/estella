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

  engine singletons     ``ecs::Registry&`` / ``resource::ResourceManager&``: the
                        host has exactly one of each, so they are implicit and
                        consume no JS argument (see ``_IMPLICIT_REFS``)
  scalars               u32/i32/f32/f64/bool/int/float/double
  ``uintptr_t`` ptr     an offset into the host's heap arena — the same thing it is
                        on the web, where the heap is wasm's linear memory (see
                        native/host/heap.hpp). A JS buffer handed straight across is
                        still accepted and copied in. Either way the binding's own
                        BoundarySpan validation runs, now against a real region.
  strings               ``const std::string&`` / ``const char*`` in, and either out:
                        a JS string, copied for the call. Not bulk data, so no heap
  returns               void / integer / float / bool / string, or a pointer WITH an
                        ``@heapreturn`` byte count

Anything else — ``emscripten::val`` results, a typed pointer, a pointer return with
no ``@heapreturn`` — is SKIPPED and reported, never silently dropped: the skip list
is what tells you which entry points still need a hand-written binding.
"""

import re
from typing import List, NamedTuple, Optional, Tuple

# What the wrapper can marshal, and how each maps to a QuickJS read.
_INT_TYPES = {'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64',
              'int', 'int32_t', 'uint32_t', 'size_t', 'long'}
_FLOAT_TYPES = {'f32', 'f64', 'float', 'double'}
_BOOL_TYPES = {'bool'}
_STRING = 'std::string'
# A C string, in or out. The module surfaces written as plain C use these where the
# C++ ones use std::string; both cross the boundary as a JS string, and neither needs
# the heap — a name or an animation id is not bulk data.
_CSTR = 'char*'
_VOID = 'void'

# A pointer-returning entry point hands back memory the MODULE owns (a static
# buffer, a vector's storage), which is not in the heap JS can read. The
# declaration says how many bytes it covers and the wrapper copies them into a
# stable heap slot, returning that offset — so the SDK reads the result exactly as
# it reads a wasm one, and nothing about the buffer's extent is guessed:
#
#   // @heapreturn physics_getDynamicBodyCount() * PHYSICS_BODY_STRIDE_BYTES
#   uintptr_t physics_getDynamicBodyTransforms();
#
# The expression is C++, evaluated in the generated TU right after the call — at
# GLOBAL scope, so any engine name in it needs qualifying (`esengine::f32`).
_HEAP_RETURN = re.compile(r'@heapreturn\s+(?P<expr>.+?)\s*$', re.MULTILINE)

# Reference parameters the host answers for itself: it runs exactly one registry
# and one resource manager, so these consume no JS argument and the wrapper passes
# the shim's accessor. Everything else taken by reference is a genuine object the
# boundary cannot marshal, and is skipped.
_IMPLICIT_REFS = {
    'ecs::Registry&': 'esn_reg()',
    'resource::ResourceManager&': 'esn_rm()',
}

# How a declaration spells each of them, matched on the type's last segment.
_IMPLICIT_SUFFIXES = {
    'Registry': 'ecs::Registry&',
    'ResourceManager': 'resource::ResourceManager&',
}

# `void name(args);` on one or more lines, inside the header's namespace. The return
# type may be const-qualified and may be a pointer (`const char* spine_getLastError()`)
# — without both, such a declaration matched nothing at all and was dropped without
# even reaching the skip list, which is the one thing this generator must never do.
_DECL = re.compile(
    r'^(?P<ret>(?:const\s+)?[A-Za-z_][\w:]*(?:\s*\*)?)\s+(?P<name>[A-Za-z_]\w*)\s*\((?P<args>[^;{]*)\)\s*;',
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
    # The C++ byte-count expression from an `@heapreturn` annotation, for an entry
    # point that returns module-owned memory (see _HEAP_RETURN).
    heap_return: Optional[str] = None
    # C entry points (`extern "C"`) are not in namespace esengine, so the wrapper
    # calls them unqualified.
    extern_c: bool = False


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

    # A header that opens `extern "C"` declares C entry points throughout (the
    # standalone modules — physics, spine, video — are written that way), so their
    # wrappers must call them unqualified.
    extern_c = 'extern "C"' in body

    for match in _DECL.finditer(body):
        ret = _clean(match.group('ret'))
        name = match.group('name')
        if name in {'if', 'for', 'while', 'switch', 'return', 'namespace', 'class'}:
            continue
        heap_return = _heap_return_before(body, match.start())
        params, reason = _parse_params(match.group('args'))
        if reason is None and not _returnable(ret, heap_return):
            reason = (f'returns {ret}; annotate it with `@heapreturn <bytes>` if it hands '
                      f'back module memory') if ret == 'uintptr_t' else f'returns {ret}'
        if reason is not None:
            skipped.append(Skipped(name, reason))
            continue
        functions.append(Function(name, ret, params, guards_at(match.start()),
                                  heap_return, extern_c))
    return functions, skipped


def _heap_return_before(body: str, pos: int) -> Optional[str]:
    """The `@heapreturn` expression annotating the declaration at @p pos, if any.

    Read from the comment block immediately above it — the annotation belongs next
    to the declaration it describes, not in a table somewhere else.
    """
    head = body[:pos].rstrip()
    lines: List[str] = []
    for line in reversed(head.splitlines()):
        token = line.strip()
        if not token.startswith('//') and not token.startswith('*') and not token.startswith('/*'):
            break
        lines.append(token)
    match = _HEAP_RETURN.search('\n'.join(lines))
    return match.group('expr').strip() if match else None


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
        # `ecs::Registry &registry` / `resource::ResourceManager &rm` → the host's
        # one of each, no JS argument.
        implicit = next((t for suffix, t in _IMPLICIT_SUFFIXES.items()
                         if parts[0].endswith(suffix)), None) if '&' in decl else None
        if implicit:
            params.append(Param(implicit, parts[-1]))
            continue
        # `const std::string&` — a JS string, read as UTF-8 for the call's duration.
        if parts[0] == _STRING:
            params.append(Param(_STRING, parts[-1]))
            continue
        # `const char*` — the same, handed over as a pointer.
        if decl.replace(' ', '').startswith('char*'):
            params.append(Param(_CSTR, parts[-1]))
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


def _returnable(ret: str, heap_return: Optional[str] = None) -> bool:
    if ret == 'uintptr_t':
        # Only with an annotation saying how much memory it covers.
        return heap_return is not None
    return (ret in (_VOID, _STRING, _CSTR)
            or ret in _INT_TYPES | _FLOAT_TYPES | _BOOL_TYPES)


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

    @staticmethod
    def _js_name(name: str) -> str:
        """The global the wrapper is registered under.

        `es_` marks the boundary surface, so a C name that already carries it keeps
        it — the video module's entry points are spelled `es_video_open`, and
        `es_es_video_open` would read as a mistake on both sides of the boundary.
        """
        return name if name.startswith('es_') else f'es_{name}'

    def _wrapper(self, fn: Function) -> List[str]:
        js_params = [p for p in fn.params if p.cpp_type not in _IMPLICIT_REFS]
        out = [f'#ifdef {g}' for g in fn.guards]
        out.append(f'static JSValue {self._js_name(fn.name)}'
                   f'(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {{')
        if js_params:
            out.append(f'    if (argc < {len(js_params)}) return JS_UNDEFINED;')
        out.append('    (void)argc; (void)argv;')

        call_args: List[str] = []
        # (local, js argument index) per buffer argument, so a copied-in buffer is
        # released after the call — see esn_argRelease.
        ptr_releases: List[Tuple[str, int]] = []
        # C-string arguments, freed after the call for the same reason.
        cstr_frees: List[str] = []
        js_index = 0
        for param in fn.params:
            if param.cpp_type in _IMPLICIT_REFS:
                call_args.append(_IMPLICIT_REFS[param.cpp_type])
                continue
            local = f'a{js_index}'
            if param.cpp_type == 'uintptr_t':
                # A heap offset, the same as it is on the web — the host's arena
                # plays the part of wasm's linear memory (see host/heap.hpp). A JS
                # buffer handed straight across is copied in and released after the
                # call. The binding's own BoundarySpan check runs either way, and
                # now against a real region.
                out.append(f'    const uint32_t {local}_off = esn_argOffset(ctx, argv[{js_index}]);')
                out.append(f'    const uintptr_t {local} = esn_heapAddr({local}_off);')
                ptr_releases.append((local, js_index))
            elif param.cpp_type == _CSTR:
                # Owned by the wrapper for the duration of the call. A missing or
                # non-string argument reads as empty, matching how cwrap coerces one.
                out.append(f'    const char* {local}_c = JS_ToCString(ctx, argv[{js_index}]);')
                out.append(f'    const char* {local} = {local}_c ? {local}_c : "";')
                cstr_frees.append(local)
            elif param.cpp_type == _STRING:
                # A JS string, owned by the wrapper for the call. An absent or
                # non-string argument reads as empty rather than aborting the call,
                # matching how embind coerces one.
                out.append(f'    const char* {local}_c = JS_ToCString(ctx, argv[{js_index}]);')
                out.append(f'    const std::string {local} = {local}_c ? {local}_c : "";')
                out.append(f'    if ({local}_c) JS_FreeCString(ctx, {local}_c);')
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

        scope = '' if fn.extern_c else 'esengine::'
        call = f'{scope}{fn.name}({", ".join(call_args)})'
        releases = [f'    esn_argRelease(ctx, argv[{index}], {local}_off);'
                    for local, index in ptr_releases]
        releases += [f'    if ({local}_c) JS_FreeCString(ctx, {local}_c);' for local in cstr_frees]
        if fn.ret == _VOID:
            out.append(f'    {call};')
            out.extend(releases)
            out.append('    return JS_UNDEFINED;')
        else:
            # Hold the result, release the scratch, then convert — a wrapper must
            # not leak the copy on the returning paths.
            if fn.ret in _BOOL_TYPES:
                out.append(f'    const bool result = {call};')
                out.extend(releases)
                out.append('    return JS_NewBool(ctx, result);')
            elif fn.ret in _FLOAT_TYPES:
                out.append(f'    const double result = static_cast<double>({call});')
                out.extend(releases)
                out.append('    return JS_NewFloat64(ctx, result);')
            elif fn.ret == _STRING:
                out.append(f'    const std::string result = {call};')
                out.extend(releases)
                out.append('    return JS_NewStringLen(ctx, result.data(), result.size());')
            elif fn.ret == _CSTR:
                # The module owns the storage (a static scratch string), so the value
                # is copied into a JS string here rather than published to the heap.
                # A null answers as empty, which is what UTF8ToString(0) reads as.
                out.append(f'    const char* result = {call};')
                out.extend(releases)
                out.append('    return JS_NewString(ctx, result ? result : "");')
            elif fn.ret == 'uintptr_t':
                # Module-owned memory: copy `@heapreturn` bytes into this entry
                # point's own heap slot and answer the offset, so the SDK reads the
                # result the same way it reads a wasm pointer. One slot per entry
                # point, so two consecutive readbacks cannot clobber each other.
                out.append('    static EsnSlot slot;')
                out.append(f'    const uintptr_t src = {call};')
                out.append(f'    const size_t bytes = static_cast<size_t>({fn.heap_return});')
                out.extend(releases)
                out.append('    return JS_NewUint32(ctx, esn_publish(slot, '
                           'reinterpret_cast<const void*>(src), bytes));')
            else:
                out.append(f'    const int64_t result = static_cast<int64_t>({call});')
                out.extend(releases)
                out.append('    return JS_NewInt64(ctx, result);')
        out.append('}')
        out.extend('#endif' for _ in fn.guards)
        out.append('')
        return out

    # ---- the TS half -------------------------------------------------------
    # The same declarations, as the object a native host answers them through.
    # The SDK's plugins call these by the module's own names, so a plugin reaches
    # whichever core is present without knowing which (see ecs/engineApi.ts).
    _TS_RETURN = {'void': 'void', 'bool': 'boolean', _STRING: 'string', _CSTR: 'string'}

    @staticmethod
    def _ts_type(cpp: str) -> str:
        if cpp in _BOOL_TYPES:
            return 'boolean'
        if cpp in (_STRING, _CSTR):
            return 'string'
        if cpp in _IMPLICIT_REFS:
            return 'unknown'
        return 'number'

    def _ts_signature(self, fn: Function) -> str:
        params = ', '.join(f'{p.name}: {self._ts_type(p.cpp_type)}' for p in fn.params)
        ret = self._TS_RETURN.get(fn.ret, 'number')
        return f'{fn.name}?({params}): {ret};'

    def generate_ts(self) -> str:
        """The native engine API: every generated entry point, callable by the
        name the wasm module exposes it under."""
        functions = self._functions()

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
            '// Every member is optional: a core answers what it compiles. A `…Ptr`',
            '// argument is an offset into the heap the core marshals through — wasm linear',
            '// memory on the web, the host arena on a device — so a caller writes it the',
            '// same way on both (see ecs/nativeHeap.ts).',
            '',
            'export interface NativeEngineApi {',
        ]
        for fn in functions:
            lines.append(f'    {self._ts_signature(fn)}')
        lines.append('}')
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
            '            ? (_implicit: unknown, ...args: unknown[]) => call(...args)',
            '            : (...args: unknown[]) => call(...args);',
            '    };',
        ])
        for fn in functions:
            takes_implicit = any(p.cpp_type in _IMPLICIT_REFS for p in fn.params)
            lines.append(f"    bind('{fn.name}', '{self._js_name(fn.name)}', "
                         f"{str(takes_implicit).lower()});")
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
            '#include <string>',
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
            js_arity = len([p for p in fn.params if p.cpp_type not in _IMPLICIT_REFS])
            lines.extend(f'#ifdef {g}' for g in fn.guards)
            js = self._js_name(fn.name)
            lines.append(f'    JS_SetPropertyStr(ctx, global, "{js}", '
                         f'JS_NewCFunction(ctx, {js}, "{js}", {js_arity}));')
            lines.extend('#endif' for _ in fn.guards)
        lines.append('}')
        lines.append('')
        return '\n'.join(lines)
