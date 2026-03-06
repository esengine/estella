/**
 * @file    CompoundCommand.ts
 * @brief   Compound command for batching multiple commands as one undo unit
 */

import type { EntityData, SceneData } from '../types/SceneTypes';
import { BaseCommand, CommandRegistry, type ChangeEmitter, type Command, type SerializedCommand } from './Command';

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

    serialize(): SerializedCommand | null {
        const serializedCmds: SerializedCommand[] = [];
        for (const cmd of this.commands_) {
            const s = cmd.serialize();
            if (!s) return null;
            serializedCmds.push(s);
        }
        return {
            type: this.type,
            data: { commands: serializedCmds, description: this.description },
        };
    }

    static {
        CommandRegistry.register('compound', (data, scene, entityMap) => {
            const serializedCmds = data.commands as SerializedCommand[];
            const commands: Command[] = [];
            for (const s of serializedCmds) {
                const cmd = CommandRegistry.deserialize(s, scene, entityMap);
                if (!cmd) return null as unknown as Command;
                commands.push(cmd);
            }
            return new CompoundCommand(commands, data.description as string);
        });
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
