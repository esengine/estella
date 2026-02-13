/**
 * @file    CompoundCommand.ts
 * @brief   Compound command for batching multiple commands as one undo unit
 */

import { BaseCommand, type Command } from './Command';

export class CompoundCommand extends BaseCommand {
    readonly type = 'compound';
    readonly description: string;

    constructor(private commands_: Command[], description: string) {
        super();
        this.description = description;
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
}
