// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Map the file references read by the material loader, in the parsed document. */
export function mapMaterialRefs(document: unknown, map: (ref: string) => string): void {
  if (!document || typeof document !== 'object') return;
  const material = document as Record<string, unknown>;
  // An instance uses its parent's shader, even if its document still carries a shader ref.
  const parent = material.instanceOf;
  if (typeof parent === 'string' && parent) material.instanceOf = map(parent);
  else if (typeof material.shader === 'string' && material.shader) material.shader = map(material.shader);
  if (material.properties && typeof material.properties === 'object') {
    const props = material.properties as Record<string, unknown>;
    for (const [name, ref] of Object.entries(props)) {
      if (typeof ref === 'string' && ref) props[name] = map(ref);
    }
  }
}
