/**
 * @file    PropertyCommand.ts
 * @brief   Command for component property changes with merge support
 */

import type { Entity } from 'esengine';
import type { SceneData, EntityData } from '../types/SceneTypes';
import { BaseCommand, type Command } from './Command';

// =============================================================================
// Constants
// =============================================================================

const MERGE_WINDOW_MS = 500;

// =============================================================================
// PropertyCommand
// =============================================================================

export class PropertyCommand extends BaseCommand {
    readonly type = 'property';
    readonly description: string;

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entity_: Entity,
        private componentType_: string,
        private propertyName_: string,
        private oldValue_: unknown,
        private newValue_: unknown
    ) {
        super();
        this.description = `Change ${componentType_}.${propertyName_}`;
    }

    execute(): void {
        this.setPropertyValue(this.newValue_);
    }

    undo(): void {
        this.setPropertyValue(this.oldValue_);
    }

    canMerge(other: Command): boolean {
        if (!(other instanceof PropertyCommand)) return false;
        if (other.entity_ !== this.entity_) return false;
        if (other.componentType_ !== this.componentType_) return false;
        if (other.propertyName_ !== this.propertyName_) return false;
        return other.timestamp - this.timestamp < MERGE_WINDOW_MS;
    }

    merge(other: Command): Command {
        const otherProp = other as PropertyCommand;
        return new PropertyCommand(
            this.scene_,
            this.entityMap_,
            this.entity_,
            this.componentType_,
            this.propertyName_,
            this.oldValue_,
            otherProp.newValue_
        );
    }

    get componentType(): string {
        return this.componentType_;
    }

    private setPropertyValue(value: unknown): void {
        const entityData = this.entityMap_.get(this.entity_ as number);
        if (!entityData) return;

        const component = entityData.components.find(c => c.type === this.componentType_);
        if (component) {
            component.data[this.propertyName_] = value;
        }
    }
}
