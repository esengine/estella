import type { Entity } from 'esengine';
import type { SceneData, EntityData } from '../types/SceneTypes';
import { BaseCommand, CommandRegistry, type ChangeEmitter, type SerializedCommand } from './Command';

export interface TileChange {
    index: number;
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

        const tiles = component.data.tiles as number[];
        if (!tiles) return;

        for (const change of this.changes_) {
            tiles[change.index] = forward ? change.newTile : change.oldTile;
        }
    }
}
