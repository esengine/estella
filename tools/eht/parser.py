"""C++ header parser for ES_COMPONENT/ES_PROPERTY/ES_ENUM macros."""

import re
import sys
from pathlib import Path
from typing import Dict, List
from .data import Component, Enum, Property


class CppParser:
    """Parses C++ headers and extracts component/enum definitions."""

    RE_NAMESPACE = re.compile(r'namespace\s+([\w:]+)\s*\{')
    RE_COMPONENT = re.compile(r'ES_COMPONENT\s*\(\s*\)\s*struct\s+(\w+)')
    RE_ENUM = re.compile(r'ES_ENUM\s*\(\s*\)\s*enum\s+class\s+(\w+)(?:\s*:\s*(\w+))?')
    RE_PROPERTY = re.compile(
        r'ES_PROPERTY\s*\(\s*([^)]*)\s*\)\s*'
        r'([^;]+?)\s+(\w+)\s*'
        r'(?:\{([^}]*)\}|=\s*([^;]+))?;'
    )
    RE_ENUM_VALUE = re.compile(r'(\w+)\s*(?:=\s*\d+)?\s*,?')

    def __init__(self):
        self.components: List[Component] = []
        self.enums: List[Enum] = []
        self.warnings: List[str] = []

    def parse_file(self, filepath: Path) -> None:
        content = filepath.read_text(encoding='utf-8')
        ns_match = self.RE_NAMESPACE.search(content)
        namespace = ns_match.group(1) if ns_match else ""
        self._parse_enums(content, namespace)
        self._parse_components(content, namespace, filepath)

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

            enum_body = content[brace_start + 1:brace_end]
            values = [m.group(1) for m in self.RE_ENUM_VALUE.finditer(enum_body) if m.group(1)]

            self.enums.append(Enum(
                name=enum_name, namespace=namespace,
                values=values, underlying_type=underlying
            ))

    def _parse_components(self, content: str, namespace: str, filepath: Path) -> None:
        for match in self.RE_COMPONENT.finditer(content):
            comp_name = match.group(1)
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
                header_path=str(filepath.as_posix())
            )

            for prop_match in self.RE_PROPERTY.finditer(body):
                annotations = self._parse_annotations(prop_match.group(1))
                cpp_type = prop_match.group(2).strip()
                prop_name = prop_match.group(3).strip()
                default = prop_match.group(4) or prop_match.group(5)

                # Validate annotations
                self._validate_annotations(comp_name, prop_name, cpp_type, annotations, filepath)

                component.properties.append(Property(
                    name=prop_name, cpp_type=cpp_type,
                    default_value=default.strip() if default else None,
                    annotations=annotations
                ))

            if not component.properties:
                self.warnings.append(
                    f"{filepath}:{comp_name}: ES_COMPONENT with no ES_PROPERTY fields"
                )

            self.components.append(component)

    def _validate_annotations(self, comp_name: str, prop_name: str, cpp_type: str,
                              annotations: Dict[str, str], filepath: Path) -> None:
        """Validate annotation usage and emit warnings for likely mistakes."""
        known_annotations = {'animatable', 'anim_override', 'asset', 'entity_ref', 'readonly'}

        for key in annotations:
            if key not in known_annotations and '=' not in key:
                self.warnings.append(
                    f"{filepath}:{comp_name}.{prop_name}: "
                    f"unknown annotation '{key}' (known: {', '.join(sorted(known_annotations))})"
                )

        if 'asset' in annotations:
            valid_asset_types = {'texture', 'material', 'font', 'audio', 'spine_skeleton', 'spine_atlas'}
            asset_type = annotations['asset']
            if asset_type not in valid_asset_types:
                self.warnings.append(
                    f"{filepath}:{comp_name}.{prop_name}: "
                    f"unknown asset type '{asset_type}' (known: {', '.join(sorted(valid_asset_types))})"
                )

    @staticmethod
    def _parse_annotations(raw: str) -> Dict[str, str]:
        result: Dict[str, str] = {}
        for token in raw.split(','):
            token = token.strip()
            if not token:
                continue
            if '=' in token:
                key, value = token.split('=', 1)
                result[key.strip()] = value.strip()
            else:
                result[token] = 'true'
        return result

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
