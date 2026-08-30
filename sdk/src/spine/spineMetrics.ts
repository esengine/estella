// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spineMetrics.ts
 * @brief   What one runtime's frame cost, as facts rather than a number.
 *
 * @details Fine-grained is COUNTED, coarse-grained is TIMED. A clock read beside
 *          each of the eleven crossings an entity makes is eleven thousand clock
 *          reads at a thousand entities — the observer becoming the thing worth
 *          observing. So the counts are exact and free, and the timers are two
 *          per runtime per frame.
 *
 *          Which is why `readback` is one phase here and not four. Splitting it
 *          into discover / extract / transfer needs a clock at every batch
 *          boundary; that experiment lives in benchmarks/spine-readback-phases,
 *          where paying for it changes nothing anyone ships.
 *
 *          Aggregated per RUNTIME, never per entity: the unit anything is done
 *          about — a batch ABI, a shared buffer, a version that misbehaves — is
 *          one loaded Spine version, and a map keyed by entity would allocate
 *          per entity to say so.
 */

/**
 * What one skeleton's clipping costs, in work rather than time. Three facts and
 * not one score, because they do not grow alike: `rawVertices` prices OPENING a
 * region and rises faster than itself, `edgeWork` prices the cut and is linear
 * in triangles x edges, amplification is what clipping hands the stages after.
 */
export interface SpineClipBudget {
    /** The polygon as authored. Fixed by the attachment, not by the pose. */
    rawVertices: number;
    /** Convex pieces it decomposed into. More than one means concave. */
    pieces: number;
    /** Edges across those pieces — what a cut is actually charged per triangle. */
    effectiveEdges: number;

    /** Triangles that reached the region at all. */
    candidateTriangles: number;
    /** …whose bounds could not meet it. */
    rejectedTriangles: number;
    /** …that were wholly inside a convex one and passed through untouched. */
    bypassedTriangles: number;
    /** …that the cut actually ran on. The only ones a budget is charged for. */
    chargedTriangles: number;
    /** Σ charged triangles x the edges of the region charging them. */
    edgeWork: number;

    inputVertices: number;
    outputVertices: number;
    outputTriangles: number;
    /** Sharing the cut destroyed: it rebuilds every triangle's own vertices. */
    vertexAmplification: number;
    triangleAmplification: number;
}

/** Every crossing a frame made into the module, by what it asked for. */
export interface SpineAbiCounts {
    pose: number;
    /** Crossings that resolved world transforms — the other half of a pose. */
    world: number;
    batchCount: number;
    vertexCount: number;
    indexCount: number;
    batchData: number;
    malloc: number;
    free: number;
    submit: number;
}

/** Bytes moved, which no call count can stand in for. */
export interface SpineByteCounts {
    /** Read out of the module's heap by the walk. */
    wasmRead: number;
    /** Written into the engine core's heap for submission. */
    coreWrite: number;
    /** Handed out by the module's allocator for one frame's batches. */
    scratchAllocated: number;
}

/** One runtime's frame. Mutated in place — a frame that allocates to say what a
 *  frame cost is measuring itself. */
/**
 * A frame's posing, as what was asked for rather than what was called.
 *
 * `worldDeferred` is a demand that found the world already current — which is
 * how "at most one materialization per revision" reads from the outside.
 */
export interface SpinePoseCounts {
    logicalUpdates: number;
    worldMaterializations: number;
    worldDeferred: number;
    meshExtractions: number;
    /** Extractions the camera in hand would not have drawn. Counted, not acted on. */
    renderCulled: number;
}

export interface SpineFrameMetrics {
    frame: number;
    entities: number;
    residencies: number;
    meshBatches: number;
    vertices: number;
    indices: number;
    abi: SpineAbiCounts;
    /** What the frame's poses were made of, in demand rather than in calls. */
    pose: SpinePoseCounts;
    bytes: SpineByteCounts;
    /** Milliseconds. `readback` is the whole extract+submit pass; see the file
     *  note for why it is not four numbers. */
    time: { pose: number; readback: number; total: number };
}

export function newSpineFrameMetrics(): SpineFrameMetrics {
    return {
        frame: 0, entities: 0, residencies: 0, meshBatches: 0, vertices: 0, indices: 0,
        abi: { pose: 0, world: 0, batchCount: 0, vertexCount: 0, indexCount: 0, batchData: 0, malloc: 0, free: 0, submit: 0 },
        pose: { logicalUpdates: 0, worldMaterializations: 0, worldDeferred: 0, meshExtractions: 0, renderCulled: 0 },
        bytes: { wasmRead: 0, coreWrite: 0, scratchAllocated: 0 },
        time: { pose: 0, readback: 0, total: 0 },
    };
}

/** Start a frame's counts over, keeping the object. */
export function beginSpineFrame(m: SpineFrameMetrics): void {
    m.frame++;
    m.entities = 0; m.residencies = 0; m.meshBatches = 0; m.vertices = 0; m.indices = 0;
    m.abi.pose = 0; m.abi.world = 0; m.abi.batchCount = 0; m.abi.vertexCount = 0; m.abi.indexCount = 0;
    m.abi.batchData = 0; m.abi.malloc = 0; m.abi.free = 0; m.abi.submit = 0;
    m.bytes.wasmRead = 0; m.bytes.coreWrite = 0; m.bytes.scratchAllocated = 0;
    m.pose.logicalUpdates = 0; m.pose.worldMaterializations = 0;
    m.pose.worldDeferred = 0; m.pose.meshExtractions = 0; m.pose.renderCulled = 0;
    m.time.pose = 0; m.time.readback = 0; m.time.total = 0;
}

/** What a frame reports as it goes: counters only, incremented at the call sites
 *  that make the crossings. Shared with every skeletal runtime — the walk is. */
export interface SkeletalProbe {
    meshBatches: number;
    vertices: number;
    indices: number;
    abi: SpineAbiCounts;
    bytes: SpineByteCounts;
}

/** The last N frames of one number, and what they were. A mean hides the frame
 *  that missed: four at 4ms and one at 9ms averages to a budget nobody blew. */
export class SpineTimeWindow {
    private samples_: Float64Array;
    private count_ = 0;
    private at_ = 0;
    private scratch_: Float64Array;

    constructor(readonly capacity = 120) {
        this.samples_ = new Float64Array(capacity);
        this.scratch_ = new Float64Array(capacity);
    }

    push(ms: number): void {
        this.samples_[this.at_] = ms;
        this.at_ = (this.at_ + 1) % this.capacity;
        if (this.count_ < this.capacity) this.count_++;
    }

    get size(): number {
        return this.count_;
    }

    /** last / mean / p50 / p95 / max over the window. Allocates one object per
     *  CALL, which is a diagnostic reading its own answer, not a frame. */
    stats(): { last: number; mean: number; p50: number; p95: number; max: number } {
        if (this.count_ === 0) return { last: 0, mean: 0, p50: 0, p95: 0, max: 0 };
        const sorted = this.scratch_.subarray(0, this.count_);
        sorted.set(this.samples_.subarray(0, this.count_));
        sorted.sort();
        let sum = 0;
        for (let i = 0; i < this.count_; i++) sum += sorted[i];
        const at = (q: number) => sorted[Math.min(this.count_ - 1, Math.floor(q * this.count_))];
        return {
            last: this.samples_[(this.at_ - 1 + this.capacity) % this.capacity],
            mean: sum / this.count_,
            p50: at(0.5),
            p95: at(0.95),
            max: sorted[this.count_ - 1],
        };
    }
}
