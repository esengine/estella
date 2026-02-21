/**
 * @file    CompoundCommand.ts
 * @brief   Compound command for batching multiple commands as one undo unit
 */

import type { EntityData } from '../types/SceneTypes';
import { BaseCommand, type ChangeEmitter, type Command } from './Command';

export class CompoundCommand extends BaseCommand {
    readonly type = 'compound';
    readonly description: string;
    readonly structural: boolean;

    constructor(private commands_: Command[], description: string) {
        super();
        this.description = description;
        this.structural = commands_.some(c => c.structural);
    }

    get commands(): readonly Command[] {
        return this.commands_;
    }

    execute(): void {
        for (const cmd of this.commands_) {
            cmd.execute();
        }
    }

    undo(): void {
        for (let i = this.commands_.length - 1; i >= 0; i--) {
            this.commands_[i].undo();
        }
    }

    updateEntityMap(map: Map<number, EntityData>, isUndo: boolean): void {
        if (isUndo) {
            for (let i = this.commands_.length - 1; i >= 0; i--) {
                this.commands_[i].updateEntityMap(map, isUndo);
            }
        } else {
            for (const cmd of this.commands_) {
                cmd.updateEntityMap(map, isUndo);
            }
        }
    }

    emitChangeEvents(emitter: ChangeEmitter, isUndo: boolean): void {
        if (isUndo) {
            for (let i = this.commands_.length - 1; i >= 0; i--) {
                this.commands_[i].emitChangeEvents(emitter, isUndo);
            }
        } else {
            for (const cmd of this.commands_) {
                cmd.emitChangeEvents(emitter, isUndo);
            }
        }
    }
}
