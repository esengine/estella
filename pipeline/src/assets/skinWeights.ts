// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export interface SkinWeightSet {
    joints: Float32Array;
    weights: Float32Array;
}

export interface SkinWeights {
    joints: Uint16Array;
    weights: Float32Array;
    reducedVertices: number;
    normalizedVertices: number;
    mergedVertices: number;
    maxDiscardedWeight: number;
}

/** Consolidates source influences into the runtime's four-weight vertex layout. */
export function normalizeSkinWeights(sets: SkinWeightSet[], vertexCount: number,
                                     jointCount: number): SkinWeights {
    const result: SkinWeights = {
        joints: new Uint16Array(vertexCount * 4), weights: new Float32Array(vertexCount * 4),
        reducedVertices: 0, normalizedVertices: 0, mergedVertices: 0, maxDiscardedWeight: 0,
    };
    const accumulated = new Float64Array(jointCount);
    const touched = new Uint16Array(jointCount);
    const best = new Uint16Array(4);

    for (let v = 0; v < vertexCount; v++) {
        let count = 0, total = 0, merged = false;
        for (const set of sets) {
            for (let c = 0; c < 4; c++) {
                const weight = set.weights[v * 4 + c]!;
                if (!Number.isFinite(weight) || weight < 0) {
                    throw new Error(`vertex ${v} has a non-finite or negative skin weight`);
                }
                if (weight === 0) continue;
                const joint = set.joints[v * 4 + c]!;
                if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount) {
                    throw new Error(`vertex ${v} weights joint ${joint} outside the skin's ${jointCount} joints`);
                }
                if (accumulated[joint] === 0) touched[count++] = joint;
                else merged = true;
                accumulated[joint]! += weight;
                total += weight;
            }
        }
        if (count === 0) throw new Error(`vertex ${v} has no positive skin weights`);
        if (merged) result.mergedVertices++;
        if (Math.abs(total - 1) > 1e-5) result.normalizedVertices++;

        let kept = 0;
        for (let i = 0; i < count; i++) {
            const joint = touched[i]!;
            if (count <= 4) {
                best[kept++] = joint;
                continue;
            }
            let at = 0;
            // Equal weights retain source order, including across attribute sets.
            while (at < kept && accumulated[joint]! <= accumulated[best[at]!]!) at++;
            if (at >= 4) continue;
            for (let k = Math.min(kept, 3); k > at; k--) best[k] = best[k - 1]!;
            best[at] = joint;
            kept = Math.min(kept + 1, 4);
        }
        let retained = 0;
        for (let c = 0; c < kept; c++) retained += accumulated[best[c]!]!;
        for (let c = 0; c < kept; c++) {
            const joint = best[c]!;
            result.joints[v * 4 + c] = joint;
            result.weights[v * 4 + c] = accumulated[joint]! / retained;
        }
        if (count > 4) {
            result.reducedVertices++;
            result.maxDiscardedWeight = Math.max(result.maxDiscardedWeight, (total - retained) / total);
        }
        for (let i = 0; i < count; i++) accumulated[touched[i]!] = 0;
    }
    return result;
}
