"""C++ header parser for ES_COMPONENT/ES_PROPERTY/ES_ENUM macros."""

import re
import sys
from pathlib import Path
from typing import Dict, List
from .data import Component, Enum, Property


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except (TypeError, ValueError):
        return False


class CppParser:
    """Parses C++ headers and extracts component/enum definitions."""

    RE_NAMESPACE = re.compile(r'namespace\s+([\w:]+)\s*\{')
    # Same annotation group as RE_PROPERTY (see below), so ES_COMPONENT takes
    # component-level metadata by the same grammar its fields take theirs.
    RE_COMPONENT = re.compile(
        r'ES_COMPONENT\s*\(\s*((?:[^)"]|"[^"]*")*?)\s*\)\s*struct\s+(\w+)'
    )
    RE_ENUM = re.compile(r'ES_ENUM\s*\(\s*\)\s*enum\s+class\s+(\w+)(?:\s*:\s*(\w+))?')
    # The annotation group `(?:[^)"]|"[^"]*")*?` accepts runs of non-paren chars
    # OR whole quoted strings, so a `)` or `,` *inside quotes* (e.g. a tooltip) does
    # not terminate the argument list. Non-greedy stops at the first UNquoted `)`.
    RE_PROPERTY = re.compile(
        r'ES_PROPERTY\s*\(\s*((?:[^)"]|"[^"]*")*?)\s*\)\s*'
        r'([^;]+?)\s+(\w+)\s*'
        r'(?:\{([^}]*)\}|=\s*([^;]+))?;'
    )
    RE_ENUM_VALUE = re.compile(r'(\w+)\s*(?:=\s*\d+)?\s*,?')

    # ES_PROPERTY annotation vocabulary (RC9-1: ES_PROPERTY is the single authoring
    # site for editor/serialization metadata). FLAG annotations take no value; KV
    # annotations require `key=value`. A key outside both sets is an unknown
    # annotation (warning, for forward-compat); malformed *known* metadata is a hard
    # error (see _validate_annotations) — silently dropping it is the exact failure
    # RC9-1 kills.
    FLAG_ANNOTATIONS = frozenset({
        'animatable', 'anim_override', 'entity_ref', 'readonly',
        'slider', 'advanced', 'skip_serialize', 'replicated',
        # An enum-typed field renders as a multi-select bitmask instead of a single-
        # choice dropdown; suppresses the auto-generated `enum` options (the bit list
        # is curated in TS — combined values like ColorAndDepth aren't single bits).
        'flags',
    })
    KV_ANNOTATIONS = frozenset({
        'asset', 'anim_flag', 'min', 'max', 'step', 'unit', 'label',
        'tooltip', 'category', 'enum_source', 'bitmask_source', 'invalidates',
        # `enum=SomeEnum` links an int field to a C++ ES_ENUM so EHT generates the
        # editor dropdown from that enum's values — for fields kept as i32 (not the
        # enum type) but still single-choice. Enum-TYPED fields need no annotation.
        'enum',
        # `editor_default=<value>` authors the CREATION default the editor uses when
        # adding the component — where it deliberately differs from the C++ ctor
        # value (e.g. Camera is Perspective/inactive at runtime but authored as an
        # active Orthographic; Sprite.size is {1,1} world units but authored 100px).
        # Same value grammar as a C++ member initializer: number, true/false,
        # Enum::Member, or a braced vector `{100, 100}`.
        'editor_default',
        # `normalized_of=<sibling>` marks this field a FRACTION of that sibling's
        # value (Sprite.pivot is a fraction of Sprite.size), so the editor can
        # offer a pixel view of it. The stored value stays the fraction — the
        # sibling is the denominator, never a second source of truth.
        'normalized_of',
    })
    NUMERIC_ANNOTATIONS = frozenset({'min', 'max', 'step'})

    # ES_COMPONENT annotation vocabulary — metadata about the component itself,
    # validated by the same rules (unknown key = warning, malformed known key =
    # hard error). See Reflection.hpp for what each one means.
    COMPONENT_FLAG_ANNOTATIONS = frozenset({'transient'})
    COMPONENT_KV_ANNOTATIONS = frozenset({'renderable', 'stability'})
    #: What `stability=` may say. The SDK's tiers, declared at the component
    #: rather than in the generated file, which nobody may edit.
    STABILITY_TIERS = frozenset({'public', 'beta', 'experimental'})
    VALID_ASSET_TYPES = frozenset({
        'texture', 'material', 'font', 'audio',
        # A skeletal runtime's two halves. Recognised as a PAIR (see
        # metadata.py::_get_skeletal_descriptor), so adding a runtime is these two
        # entries and nothing else.
        'spine_skeleton', 'spine_atlas',
        'dragonbones_skeleton', 'dragonbones_atlas',
    })

    def __init__(self):
        self.components: List[Component] = []
        self.enums: List[Enum] = []
        self.warnings: List[str] = []
        self.errors: List[str] = []

    def parse_file(self, filepath: Path) -> None:
        content = filepath.read_text(encoding='utf-8')
        ns_match = self.RE_NAMESPACE.search(content)
        namespace = ns_match.group(1) if ns_match else ""
        self._parse_enums(content, namespace)
        self._parse_components(content, namespace, filepath)

    RE_COMMENT = re.compile(r'/\*.*?\*/|//[^\n]*', re.DOTALL)

    @classmethod
    def _strip_comments(cls, text: str) -> str:
        """Blank out C and C++ comments, keeping the text's length and lines."""
        return cls.RE_COMMENT.sub(lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text)

    def _parse_enums(self, content: str, namespace: str) -> None:
        for match in self.RE_ENUM.finditer(content):
            enum_name = match.group(1)
            underlying = match.group(2) or "int"

            brace_start = content.find('{', match.end())
            if brace_start == -1:
                continue
            brace_end = content.find('};', brace_start)
            if brace_end == -1:
                continue

            # Comments first: the value pattern is "a word, optionally = N", which
            # every word of a doc comment also matches. A member documented in
            # place ("/** Overshoot and spring back. */") otherwise contributes
            # `Overshoot`, `and`, `spring`… as enum values, and the generated C++
            # then names members that do not exist.
            enum_body = self._strip_comments(content[brace_start + 1:brace_end])
            values = [m.group(1) for m in self.RE_ENUM_VALUE.finditer(enum_body) if m.group(1)]

            self.enums.append(Enum(
                name=enum_name, namespace=namespace,
                values=values, underlying_type=underlying
            ))

    def _parse_components(self, content: str, namespace: str, filepath: Path) -> None:
        for match in self.RE_COMPONENT.finditer(content):
            comp_annotations = self._parse_annotations(match.group(1))
            comp_name = match.group(2)
            body_start = content.find('{', match.end())
            if body_start == -1:
                continue

            brace_count = 1
            body_end = body_start + 1
            while body_end < len(content) and brace_count > 0:
                if content[body_end] == '{':
                    brace_count += 1
                elif content[body_end] == '}':
                    brace_count -= 1
                body_end += 1

            body = content[body_start:body_end]
            component = Component(
                name=comp_name, namespace=namespace,
                header_path=str(filepath.as_posix()),
                annotations=comp_annotations
            )

            for prop_match in self.RE_PROPERTY.finditer(body):
                annotations = self._parse_annotations(prop_match.group(1))
                cpp_type = prop_match.group(2).strip()
                prop_name = prop_match.group(3).strip()
                default = prop_match.group(4) or prop_match.group(5)

                # Validate annotations
                self._validate_annotations(comp_name, prop_name, annotations, filepath)

                component.properties.append(Property(
                    name=prop_name, cpp_type=cpp_type,
                    default_value=default.strip() if default else None,
                    annotations=annotations
                ))

            if not component.properties:
                self.warnings.append(
                    f"{filepath}:{comp_name}: ES_COMPONENT with no ES_PROPERTY fields"
                )

            self._validate_component_refs(component, filepath)
            self._validate_component_annotations(component, filepath)
            self.components.append(component)

    def _validate_annotations(self, comp_name: str, prop_name: str,
                              annotations: Dict[str, str], filepath: Path) -> None:
        """Validate per-property annotation syntax.

        Malformed *known* metadata is a hard error: a numeric annotation that isn't
        a number, or `slider` without a range, would be silently dropped by the
        generators — the exact failure mode RC9-1 exists to kill. Unknown keys stay
        warnings (forward-compat). Flags are presence-based; their value is ignored.
        """
        loc = f"{filepath}:{comp_name}.{prop_name}"

        for key, value in annotations.items():
            if key not in self.FLAG_ANNOTATIONS and key not in self.KV_ANNOTATIONS:
                known = ', '.join(sorted(self.FLAG_ANNOTATIONS | self.KV_ANNOTATIONS))
                self.warnings.append(f"{loc}: unknown annotation '{key}' (known: {known})")
                continue
            if key in self.NUMERIC_ANNOTATIONS and not _is_number(value):
                self.errors.append(f"{loc}: annotation {key}='{value}' must be numeric")

        if 'slider' in annotations and not ('min' in annotations and 'max' in annotations):
            self.errors.append(f"{loc}: slider requires both min= and max= on the same field")

        asset_type = annotations.get('asset')
        if asset_type is not None and asset_type not in self.VALID_ASSET_TYPES:
            known = ', '.join(sorted(self.VALID_ASSET_TYPES))
            self.warnings.append(f"{loc}: unknown asset type '{asset_type}' (known: {known})")

    def _validate_component_annotations(self, component: Component, filepath: Path) -> None:
        """Validate ES_COMPONENT annotations against the component's own fields.

        `renderable=<field>` must name a bool field on this struct. A name that
        matched nothing would make the component read as not-renderable — it would
        stay drawn when its entity is hidden or its scene sleeps, which is the
        silent failure the annotation exists to end.
        """
        loc = f"{filepath}:{component.name}"
        bool_fields = {p.name for p in component.properties if p.cpp_type == 'bool'}

        for key, value in component.annotations.items():
            if key in self.COMPONENT_FLAG_ANNOTATIONS:
                continue
            if key not in self.COMPONENT_KV_ANNOTATIONS:
                known = ', '.join(sorted(
                    self.COMPONENT_FLAG_ANNOTATIONS | self.COMPONENT_KV_ANNOTATIONS
                ))
                self.warnings.append(
                    f"{loc}: unknown ES_COMPONENT annotation '{key}' (known: {known})"
                )
                continue
            # stability names a tier, not a field of this struct.
            if key == 'stability':
                if value not in self.STABILITY_TIERS:
                    known = ', '.join(sorted(self.STABILITY_TIERS))
                    self.errors.append(f"{loc}: stability='{value}' is not a tier (known: {known})")
                continue
            # A kv annotation written as a bare flag parses as the string 'true',
            # which names no field — say what it needs rather than what it got.
            if value == 'true':
                self.errors.append(f"{loc}: {key} needs a field — {key}=<bool field>")
            elif value not in bool_fields:
                self.errors.append(
                    f"{loc}: {key}='{value}' names no bool field on this component"
                )

    def _validate_component_refs(self, component: Component, filepath: Path) -> None:
        """Component-level checks that need the full field set: `invalidates=<field>`
        must name a sibling property (else the generated setter side-effect would
        reference a non-existent member), and `normalized_of=<field>` must name a
        sibling of the SAME type (the denominator is applied axis-wise, so a
        mismatched arity would divide an axis by nothing and read as 0)."""
        by_name = {p.name: p for p in component.properties}
        for prop in component.properties:
            loc = f"{filepath}:{component.name}.{prop.name}"
            target = prop.annotations.get('invalidates')
            if target is not None and target not in by_name:
                self.errors.append(f"{loc}: invalidates='{target}' names no field on this component")
            denom = prop.annotations.get('normalized_of')
            if denom is None:
                continue
            if denom == prop.name:
                self.errors.append(f"{loc}: normalized_of='{denom}' is the field itself")
            elif denom not in by_name:
                self.errors.append(f"{loc}: normalized_of='{denom}' names no field on this component")
            elif by_name[denom].cpp_type != prop.cpp_type:
                self.errors.append(
                    f"{loc}: normalized_of='{denom}' is {by_name[denom].cpp_type}, "
                    f"not {prop.cpp_type}"
                )

    @staticmethod
    def _parse_annotations(raw: str) -> Dict[str, str]:
        result: Dict[str, str] = {}
        for token in CppParser._split_top_level(raw):
            token = token.strip()
            if not token:
                continue
            if '=' in token:
                key, value = token.split('=', 1)
                result[key.strip()] = CppParser._unquote(value.strip())
            else:
                result[token] = 'true'
        return result

    @staticmethod
    def _split_top_level(raw: str) -> List[str]:
        """Split on commas that are not inside a double-quoted string or a braced
        initializer, so `tooltip="a, b"` and `editor_default={100, 100}` each stay
        one token."""
        parts: List[str] = []
        buf: List[str] = []
        in_str = False
        brace_depth = 0
        for ch in raw:
            if ch == '"':
                in_str = not in_str
                buf.append(ch)
            elif ch == '{' and not in_str:
                brace_depth += 1
                buf.append(ch)
            elif ch == '}' and not in_str:
                brace_depth -= 1
                buf.append(ch)
            elif ch == ',' and not in_str and brace_depth == 0:
                parts.append(''.join(buf))
                buf = []
            else:
                buf.append(ch)
        parts.append(''.join(buf))
        return parts

    @staticmethod
    def _unquote(s: str) -> str:
        if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
            return s[1:-1]
        return s

    def parse_directory(self, dirpath: Path) -> None:
        for filepath in dirpath.rglob('*.hpp'):
            try:
                self.parse_file(filepath)
            except Exception as e:
                self.warnings.append(f"Failed to parse {filepath}: {e}")

    def print_warnings(self) -> None:
        """Print all accumulated warnings to stderr."""
        for w in self.warnings:
            print(f"  WARNING: {w}", file=sys.stderr)

    def print_errors(self) -> None:
        """Print all accumulated hard errors to stderr."""
        for e in self.errors:
            print(f"  ERROR: {e}", file=sys.stderr)
