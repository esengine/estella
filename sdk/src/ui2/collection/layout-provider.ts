import type { Vec2 } from '../../types';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Abstract layout math for a virtualized list. Implementations answer
 * three questions for a list of fixed-size items:
 *
 * - how big is the total content?
 * - where does item `i` sit inside that content?
 * - which index range is visible in the given viewport?
 *
 * Variable-height items can be added later via an optional
 * measure callback; this revision assumes fixed-size items.
 */
export interface LayoutProvider {
    getContentSize(count: number): Vec2;
    getItemRect(index: number): Rect;
    /** Inclusive start, exclusive end. Returns [0, 0] when nothing is visible. */
    getVisibleRange(viewport: Rect, count: number): [start: number, end: number];
}

// -- Linear (row or column) ---------------------------------------------------

export interface LinearLayoutOptions {
    direction?: 'row' | 'column';
    spacing?: number;
    itemSize: Vec2;
}

export class LinearLayoutProvider implements LayoutProvider {
    private readonly dir_: 'row' | 'column';
    private readonly spacing_: number;
    private readonly itemSize_: Vec2;

    constructor(opts: LinearLayoutOptions) {
        this.dir_ = opts.direction ?? 'column';
        this.spacing_ = opts.spacing ?? 0;
        this.itemSize_ = opts.itemSize;
    }

    getContentSize(count: number): Vec2 {
        if (count <= 0) return { x: 0, y: 0 };
        const main = this.mainAxis_();
        const extent = count * main + (count - 1) * this.spacing_;
        return this.dir_ === 'column'
            ? { x: this.itemSize_.x, y: extent }
            : { x: extent, y: this.itemSize_.y };
    }

    getItemRect(index: number): Rect {
        const stride = this.stride_();
        const offset = index * stride;
        return this.dir_ === 'column'
            ? { x: 0, y: offset, width: this.itemSize_.x, height: this.itemSize_.y }
            : { x: offset, y: 0, width: this.itemSize_.x, height: this.itemSize_.y };
    }

    getVisibleRange(viewport: Rect, count: number): [number, number] {
        if (count <= 0) return [0, 0];
        const stride = this.stride_();
        if (stride <= 0) return [0, count];

        const vStart = this.dir_ === 'column' ? viewport.y : viewport.x;
        const vExtent = this.dir_ === 'column' ? viewport.height : viewport.width;
        const vEnd = vStart + vExtent;

        const firstRaw = Math.floor(vStart / stride);
        const lastRaw = Math.ceil(vEnd / stride) - 1;
        const start = Math.max(0, firstRaw);
        const end = Math.min(count, lastRaw + 1);
        return start < end ? [start, end] : [0, 0];
    }

    private mainAxis_(): number {
        return this.dir_ === 'column' ? this.itemSize_.y : this.itemSize_.x;
    }

    private stride_(): number {
        return this.mainAxis_() + this.spacing_;
    }
}

// -- Grid ---------------------------------------------------------------------

export interface GridLayoutOptions {
    columns: number;
    itemSize: Vec2;
    spacing?: Vec2;
}

export class GridLayoutProvider implements LayoutProvider {
    private readonly cols_: number;
    private readonly itemSize_: Vec2;
    private readonly spacing_: Vec2;

    constructor(opts: GridLayoutOptions) {
        this.cols_ = Math.max(1, opts.columns);
        this.itemSize_ = opts.itemSize;
        this.spacing_ = opts.spacing ?? { x: 0, y: 0 };
    }

    getContentSize(count: number): Vec2 {
        if (count <= 0) return { x: 0, y: 0 };
        const rows = Math.ceil(count / this.cols_);
        const width = this.cols_ * this.itemSize_.x + (this.cols_ - 1) * this.spacing_.x;
        const height = rows * this.itemSize_.y + (rows - 1) * this.spacing_.y;
        return { x: width, y: height };
    }

    getItemRect(index: number): Rect {
        const col = index % this.cols_;
        const row = Math.floor(index / this.cols_);
        return {
            x: col * (this.itemSize_.x + this.spacing_.x),
            y: row * (this.itemSize_.y + this.spacing_.y),
            width: this.itemSize_.x,
            height: this.itemSize_.y,
        };
    }

    getVisibleRange(viewport: Rect, count: number): [number, number] {
        if (count <= 0) return [0, 0];
        const rowStride = this.itemSize_.y + this.spacing_.y;
        if (rowStride <= 0) return [0, count];

        const firstRow = Math.max(0, Math.floor(viewport.y / rowStride));
        const lastRow = Math.ceil((viewport.y + viewport.height) / rowStride) - 1;
        const start = firstRow * this.cols_;
        const end = Math.min(count, (lastRow + 1) * this.cols_);
        return start < end ? [start, end] : [0, 0];
    }
}
