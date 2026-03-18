import type { EditorEventBus } from '../events/EditorEventBus';

export type TileBrushTool =
    | 'paint' | 'rect-fill' | 'bucket-fill' | 'eraser' | 'picker';

export interface TileBrushStamp {
    width: number;
    height: number;
    tiles: number[];
}

export class TileToolStore {
    private brushTool_: TileBrushTool = 'paint';
    private brushStamp_: TileBrushStamp = { width: 1, height: 1, tiles: [1] };
    private brushFlipH_ = false;
    private brushFlipV_ = false;

    constructor(private readonly bus_: EditorEventBus) {}

    get brushTool(): TileBrushTool {
        return this.brushTool_;
    }

    set brushTool(tool: TileBrushTool) {
        if (this.brushTool_ === tool) return;
        this.brushTool_ = tool;
        this.bus_.emitBatched('tiletool:changed', {});
    }

    get brushStamp(): Readonly<TileBrushStamp> {
        return this.brushStamp_;
    }

    set brushStamp(stamp: TileBrushStamp) {
        this.brushStamp_ = stamp;
        this.bus_.emitBatched('tiletool:changed', {});
    }

    get brushFlipH(): boolean {
        return this.brushFlipH_;
    }

    set brushFlipH(v: boolean) {
        if (this.brushFlipH_ === v) return;
        this.brushFlipH_ = v;
        this.bus_.emitBatched('tiletool:changed', {});
    }

    get brushFlipV(): boolean {
        return this.brushFlipV_;
    }

    set brushFlipV(v: boolean) {
        if (this.brushFlipV_ === v) return;
        this.brushFlipV_ = v;
        this.bus_.emitBatched('tiletool:changed', {});
    }
}
