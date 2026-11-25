// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The two inputs the GI needs from one mesh, in the caller's asset vocabulary. */
export interface MeshGIRefs { sdf: string; cards: string }

export function savedMeshGIRefs(value: unknown): MeshGIRefs | null {
    if (!value || typeof value !== 'object') return null;
    const refs = value as Partial<MeshGIRefs>;
    return typeof refs.sdf === 'string' && refs.sdf && typeof refs.cards === 'string' && refs.cards
        ? { sdf: refs.sdf, cards: refs.cards } : null;
}

export function siblingMeshGIRefs(mesh: string): MeshGIRefs | null {
    if (!/\.esmesh$/i.test(mesh)) return null;
    const base = mesh.slice(0, -7);
    return { sdf: base + '.esmeshsdf', cards: base + '.esmeshcards' };
}

/** An undeclared legacy mesh can use a complete sibling pair. A declared binding is authoritative, including an inactive one. */
export function resolveMeshGI(mesh: string, binding: unknown, resolve: (ref: string, type: 'meshSdf' | 'meshCards') => string | undefined): MeshGIRefs | null {
    if (binding && typeof binding === 'object' && 'active' in binding && binding.active === false) return null;
    const refs = binding === undefined ? siblingMeshGIRefs(mesh) : savedMeshGIRefs(binding);
    if (!refs) return null;
    const sdf = resolve(refs.sdf, 'meshSdf'), cards = resolve(refs.cards, 'meshCards');
    return sdf && cards ? { sdf, cards } : null;
}
