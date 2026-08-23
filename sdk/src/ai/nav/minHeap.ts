// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    minHeap.ts
 * @brief   The open set both searches run on — grid cells and mesh polygons are
 *          the same problem to a heap.
 */

/**
 * Binary min-heap of integer node ids keyed by an f-score, backed by flat typed
 * arrays. Lazy-deletion friendly: a node may be pushed more than once with a
 * lower key; the search skips already-closed pops.
 */
export class MinHeap {
    private nodes: Int32Array;
    private keys: Float64Array;
    size = 0;

    constructor(capacityHint: number) {
        const cap = Math.max(16, capacityHint);
        this.nodes = new Int32Array(cap);
        this.keys = new Float64Array(cap);
    }

    push(node: number, key: number): void {
        if (this.size === this.nodes.length) this.grow();
        let i = this.size++;
        this.nodes[i] = node;
        this.keys[i] = key;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[parent]! <= this.keys[i]!) break;
            this.swap(i, parent);
            i = parent;
        }
    }

    pop(): number {
        const top = this.nodes[0]!;
        const last = --this.size;
        this.nodes[0] = this.nodes[last]!;
        this.keys[0] = this.keys[last]!;
        let i = 0;
        for (;;) {
            const l = i * 2 + 1;
            const r = l + 1;
            let smallest = i;
            if (l < this.size && this.keys[l]! < this.keys[smallest]!) smallest = l;
            if (r < this.size && this.keys[r]! < this.keys[smallest]!) smallest = r;
            if (smallest === i) break;
            this.swap(i, smallest);
            i = smallest;
        }
        return top;
    }

    private swap(a: number, b: number): void {
        const tn = this.nodes[a]!; this.nodes[a] = this.nodes[b]!; this.nodes[b] = tn;
        const tk = this.keys[a]!; this.keys[a] = this.keys[b]!; this.keys[b] = tk;
    }

    private grow(): void {
        const nn = new Int32Array(this.nodes.length * 2);
        const nk = new Float64Array(this.keys.length * 2);
        nn.set(this.nodes); nk.set(this.keys);
        this.nodes = nn; this.keys = nk;
    }
}
