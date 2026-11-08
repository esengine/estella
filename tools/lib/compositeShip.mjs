// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    compositeShip.mjs
 * @brief   Shared mixed instance/chunk ship fixture for runtime and editor checks.
 */
const wood = { r: 0.55, g: 0.38, b: 0.22, a: 1 };
const transform = (x, y, z, sx = 100, sy = 100, sz = 100) => ({
    type: 'Transform', data: { position: { x, y, z }, scale: { x: sx / 100, y: sy / 100, z: sz / 100 } },
});
const mesh = name => ({ type: 'MeshRenderer', data: { mesh: name, lit: true, opaque: true, color: { ...wood } } });

/** Eighty planks and 24 posts form two instance sets; four distinct props form two merged chunks. */
export function compositeShip(withComposite = false) {
    const entities = [];
    let id = 1000;
    const root = id++;
    const children = [];
    const add = (name, components) => {
        const entity = id++;
        children.push(entity);
        entities.push({ id: entity, name, parent: root, children: [], visible: true, components });
    };
    for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) {
        add(`Plank ${i}.${j}`, [transform(-2.25 + i * 0.5, 0.4, -1.75 + j * 0.5, 0.45, 0.06, 0.45), mesh('builtin:cube')]);
    }
    for (let i = 0; i < 12; i++) for (const z of [-2, 2]) {
        add(`Post ${i}${z}`, [transform(-2.5 + i * 0.45, 0.7, z, 0.06, 0.6, 0.06), mesh('builtin:cylinder')]);
    }
    add('Barrel', [transform(-2, 0.8, 0, 0.3, 0.3, 0.3), mesh('builtin:sphere')]);
    add('Funnel', [transform(-2, 0.8, 0.8, 0.3, 0.4, 0.3), mesh('builtin:cone')]);
    add('Buoy', [transform(2, 0.8, 0, 0.2, 0.3, 0.2), mesh('builtin:capsule')]);
    add('Hatch', [transform(2, 0.45, 0.8, 0.6, 1, 0.6), mesh('builtin:plane')]);
    const components = [transform(0, 0, 0)];
    if (withComposite) components.push({ type: 'CompositeBatch', data: { instanceMin: 4, cellSize: 2 } });
    entities.unshift({ id: root, name: 'Ship', parent: null, children, visible: true, components });
    return entities;
}
