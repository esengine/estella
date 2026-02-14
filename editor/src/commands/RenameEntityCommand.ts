import type { Entity } from 'esengine';
import type { EntityData, SceneData } from '../types/SceneTypes';
import { BaseCommand, type Command } from './Command';

const MERGE_WINDOW_MS = 500;

export class RenameEntityCommand extends BaseCommand {
    readonly type = 'rename_entity';
    readonly description: string;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entity_: Entity,
        private oldName_: string,
        private newName_: string
    ) {
        super();
        this.description = `Rename entity to "${newName_}"`;
    }

    execute(): void {
        this.setName(this.newName_);
    }

    undo(): void {
        this.setName(this.oldName_);
    }

    canMerge(other: Command): boolean {
        if (!(other instanceof RenameEntityCommand)) return false;
        if (other.entity_ !== this.entity_) return false;
        return other.timestamp - this.timestamp < MERGE_WINDOW_MS;
    }

    merge(other: Command): Command {
        const otherRename = other as RenameEntityCommand;
        return new RenameEntityCommand(
            this.scene_,
            this.entityMap_,
            this.entity_,
            this.oldName_,
            otherRename.newName_
        );
    }

    private setName(name: string): void {
        const entityData = this.entityMap_.get(this.entity_ as number);
        if (entityData) {
            entityData.name = name;
        }
    }
}
