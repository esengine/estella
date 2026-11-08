// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    streamingDistricts.mjs
 * @brief   Two textured neighbourhoods exercising the shared XY and XZ residency path.
 */
export function streamingDistricts(plane, tag = 'base') {
    const screen = plane === 'xy';
    const component = (type, data = {}) => ({ type, data });
    const transform = (position, scale, rotation) => component('Transform', { position,
        ...(scale ? { scale } : {}), ...(rotation ? { rotation } : {}) });
    const persistent = (id, name, components) => ({ id, name, parent: null, children: [], visible: true,
        components: [...components, component('WorldPersistent')] });
    const entities = [
        persistent(1, 'World', [component('StreamedWorld', { cellSize: 100, plane: screen ? 1 : 0 })]),
        persistent(2, 'Observer', [transform({ x: 50, y: screen ? 50 : 0, z: screen ? 0 : 50 }),
            component('WorldStreamingSource', { loadRadius: 30, unloadRadius: 80, prefetchRadius: 500 })]),
        persistent(3, 'Camera', [transform(screen ? { x: 200, y: 150, z: 900 } : { x: 200, y: 500, z: 150 }, undefined,
            screen ? undefined : { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
        component('Camera', { isActive: true, projectionType: screen ? 1 : 0, fov: 50, orthoSize: 420, nearPlane: 0.1, farPlane: 1500 })]),
    ];
    if (!screen) entities.push(persistent(4, 'Sun', [transform({ x: 0, y: 0, z: 0 }, undefined,
        { x: -0.3826834324, y: 0, z: 0, w: 0.9238795325 }),
    component('Light', { type: 1, intensity: 1.2, color: { r: 1, g: 1, b: 1, a: 1 }, meshShadows: true, shadowExtent: 600 })]));
    for (let cell = 0; cell < 2; cell++) {
        const id = 100 + cell * 100, x = 50 + cell * 300, second = 50 + cell * 200;
        const name = `${tag}-${cell ? 'b' : 'a'}`;
        const root = { id, name: `${name}-district`, parent: null, children: [], visible: true,
            components: [transform({ x, y: screen ? second : 0, z: screen ? 0 : second })] };
        entities.push(root);
        for (let i = 0; i < 16; i++) {
            const child = id + i + 1, u = (i % 4) * 20 - 30, v = Math.floor(i / 4) * 20 - 30;
            root.children.push(child);
            entities.push({ id: child, name: `${name}-part-${i}`, parent: id, children: [], visible: true, components: [
                transform({ x: u, y: screen ? v : 0, z: screen ? 0 : v }, screen ? undefined : { x: 0.14, y: 0.16, z: 0.14 }),
                component(screen ? 'Sprite' : 'MeshRenderer', { texture: `/textures/residency-${name}.png`,
                    ...(screen ? { size: { x: 14, y: 14 } } : { mesh: i % 2 ? 'builtin:cube' : 'builtin:cylinder', lit: true, opaque: true }) }),
            ] });
        }
    }
    return { version: 4, name: `Residency ${plane} ${tag}`, entities };
}
