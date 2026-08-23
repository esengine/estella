import {
    defineSystem, GetWorld, Res, Time, MeshRenderers, type Entity,
} from 'esengine';
import { RIBBON, hsv } from '../config';

// The MeshRenderer tier: a component-owned triangle mesh. The Ribbon entity lives in
// the scene (sorted with sprites via `layer`, saved, inspectable); this system
// regenerates its vertices every frame and re-uploads through the MeshRenderers
// resource — the supported mutation path (direct writes to the component's
// `geometry` field are not change-detected).

const N = RIBBON.segments;

// Index topology never changes — two triangles per segment, built once.
const indices: number[] = [];
for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
}

let ribbon: Entity | null = null;

export const ribbonSystem = defineSystem(
    [GetWorld(), Res(MeshRenderers), Res(Time)],
    (world, meshes, time) => {
        if (ribbon === null) ribbon = world.findEntityByName('Ribbon');
        if (ribbon === null) return;

        const t = time.elapsed;
        const positions: number[] = [];
        const colors: number[] = [];
        for (let i = 0; i <= N; i++) {
            const s = i / N;
            const x = -RIBBON.halfLength + s * RIBBON.halfLength * 2;
            const envelope = Math.sin(s * Math.PI);
            const wave = Math.sin(s * RIBBON.waveFrequency * Math.PI * 2 - t * RIBBON.scrollSpeed)
                * RIBBON.waveAmplitude * envelope;
            const halfWidth = RIBBON.halfWidth * (0.25 + 0.75 * envelope);
            positions.push(x, wave + halfWidth, x, wave - halfWidth);

            const top = hsv(0.05 + s * 0.35 + t * 0.03, 0.85, 1);
            const bottom = hsv(0.05 + s * 0.35 + t * 0.03, 0.85, 0.45);
            colors.push(top.r, top.g, top.b, 1, bottom.r, bottom.g, bottom.b, 1);
        }

        meshes.setGeometry(ribbon, { positions, colors, indices });
    },
    { name: 'RibbonSystem' },
);
