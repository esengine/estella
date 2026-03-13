import type { Entity } from 'esengine';
import type { SceneData, EntityData } from '../types/SceneTypes';
import { BaseCommand, CommandRegistry, type ChangeEmitter, type SerializedCommand } from './Command';
import { CHUNK_SIZE, tileToChunk } from '../gizmos/TileChunkUtils';

export interface TileChange {
    x: number;
    y: number;
    oldTile: number;
    newTile: number;
}

export class TilePaintCommand extends BaseCommand {
    readonly type = 'tile-paint';
    readonly description: string;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entity_: Entity,
        private changes_: TileChange[],
    ) {
        super();
        this.description = `Paint ${changes_.length} tile(s)`;
    }

    execute(): void {
        this.applyTiles_(true);
    }

    undo(): void {
        this.applyTiles_(false);
    }

    canMerge(_other: import('./Command').Command): boolean {
        return false;
    }

    emitChangeEvents(emitter: ChangeEmitter, _isUndo: boolean): void {
        emitter.notifyPropertyChange({
            entity: this.entity_ as number,
            componentType: 'TilemapLayer',
            propertyName: 'tiles',
            oldValue: undefined,
            newValue: undefined,
        });
    }

    serialize(): SerializedCommand {
        return {
            type: this.type,
            data: {
                entity: this.entity_ as number,
                changes: this.changes_,
            },
        };
    }

    static {
        CommandRegistry.register('tile-paint', (data, scene, entityMap) =>
            new TilePaintCommand(
                scene, entityMap,
                data.entity as number,
                data.changes as TileChange[],
            ),
        );
    }

    private applyTiles_(forward: boolean): void {
        const entityData = this.entityMap_.get(this.entity_ as number);
        if (!entityData) return;

        const component = entityData.components.find(c => c.type === 'TilemapLayer');
        if (!component) return;

        const data = component.data as Record<string, unknown>;
        const infinite = data.infinite as boolean ?? false;

        if (infinite) {
            this.applyChunkTiles_(data, forward);
        } else {
            this.applyFlatTiles_(data, forward);
        }
    }

    private applyFlatTiles_(data: Record<string, unknown>, forward: boolean): void {
        const tiles = data.tiles as number[];
        if (!tiles) return;
        const width = data.width as number ?? 0;

        for (const change of this.changes_) {
            const index = change.y * width + change.x;
            tiles[index] = forward ? change.newTile : change.oldTile;
        }
    }

    private applyChunkTiles_(data: Record<string, unknown>, forward: boolean): void {
        let chunks = data.chunks as Record<string, number[]>;
        if (!chunks) {
            chunks = {};
            data.chunks = chunks;
        }

        for (const change of this.changes_) {
            const { cx, cy, lx, ly } = tileToChunk(change.x, change.y);
            const key = `${cx},${cy}`;

            let chunk = chunks[key];
            if (!chunk) {
                chunk = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0);
                chunks[key] = chunk;
            }

            chunk[ly * CHUNK_SIZE + lx] = forward ? change.newTile : change.oldTile;
        }
    }
}
