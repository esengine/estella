import type { EntityData, SceneData } from '../types/SceneTypes';
import { BaseCommand } from './Command';

export class ToggleVisibilityCommand extends BaseCommand {
    readonly type = 'toggle_visibility';
    readonly description: string;
    private savedStates_: Map<number, boolean> = new Map();

    constructor(
        private scene_: SceneData,
        private entityMap_: Map<number, EntityData>,
        private entityId_: number,
        private visibilityCallback_: (entityId: number, visible: boolean) => void
    ) {
        super();
        const entityData = entityMap_.get(entityId_);
        const willShow = !entityData?.visible;
        this.description = willShow ? `Show entity` : `Hide entity`;
    }

    execute(): void {
        const entityData = this.entityMap_.get(this.entityId_);
        if (!entityData) return;

        this.savedStates_.clear();
        this.captureVisibilityStates(this.entityId_);

        if (!entityData.visible) {
            const parentId = entityData.parent;
            if (parentId !== null) {
                const parentData = this.entityMap_.get(parentId);
                if (parentData && !parentData.visible) return;
            }
            this.showTree(this.entityId_);
        } else {
            this.hideTree(this.entityId_);
        }
    }

    undo(): void {
        for (const [id, visible] of this.savedStates_) {
            const entityData = this.entityMap_.get(id);
            if (entityData) {
                entityData.visible = visible;
                this.visibilityCallback_(id, visible);
            }
        }
    }

    private captureVisibilityStates(entityId: number): void {
        const entityData = this.entityMap_.get(entityId);
        if (!entityData) return;
        this.savedStates_.set(entityId, entityData.visible);
        for (const childId of entityData.children) {
            this.captureVisibilityStates(childId);
        }
    }

    private hideTree(entityId: number): void {
        const entityData = this.entityMap_.get(entityId);
        if (!entityData) return;
        entityData.visible = false;
        this.visibilityCallback_(entityId, false);
        for (const childId of entityData.children) {
            const childData = this.entityMap_.get(childId);
            if (childData && childData.visible !== false) {
                this.hideTree(childId);
            }
        }
    }

    private showTree(entityId: number): void {
        const entityData = this.entityMap_.get(entityId);
        if (!entityData) return;
        entityData.visible = true;
        this.visibilityCallback_(entityId, true);
        for (const childId of entityData.children) {
            const childData = this.entityMap_.get(childId);
            if (childData && childData.visible === false) {
                this.showTree(childId);
            }
        }
    }
}
