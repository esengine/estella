/**
 * @file    CommandHistory.ts
 * @brief   Undo/Redo command history manager
 */

import type { Command } from './Command';

// =============================================================================
// Constants
// =============================================================================

const MAX_HISTORY_SIZE = 100;

// =============================================================================
// CommandHistory
// =============================================================================

export class CommandHistory {
    private commands_: Command[] = [];
    private index_ = -1;
    private maxSize_: number;

    constructor(maxSize: number = MAX_HISTORY_SIZE) {
        this.maxSize_ = maxSize;
    }

    execute(command: Command): void {
        command.execute();

        if (this.index_ < this.commands_.length - 1) {
            this.commands_ = this.commands_.slice(0, this.index_ + 1);
        }

        const lastCommand = this.commands_[this.commands_.length - 1];
        if (lastCommand && lastCommand.canMerge(command)) {
            this.commands_[this.commands_.length - 1] = lastCommand.merge(command);
        } else {
            this.commands_.push(command);
            this.index_++;
        }

        while (this.commands_.length > this.maxSize_) {
            this.commands_.shift();
            this.index_--;
        }
    }

    undo(): boolean {
        if (!this.canUndo()) return false;

        const command = this.commands_[this.index_];
        command.undo();
        this.index_--;
        return true;
    }

    redo(): boolean {
        if (!this.canRedo()) return false;

        this.index_++;
        const command = this.commands_[this.index_];
        command.execute();
        return true;
    }

    canUndo(): boolean {
        return this.index_ >= 0;
    }

    canRedo(): boolean {
        return this.index_ < this.commands_.length - 1;
    }

    peekUndo(): Command | null {
        if (!this.canUndo()) return null;
        return this.commands_[this.index_];
    }

    peekRedo(): Command | null {
        if (!this.canRedo()) return null;
        return this.commands_[this.index_ + 1];
    }

    clear(): void {
        this.commands_ = [];
        this.index_ = -1;
    }

    get undoDescription(): string | null {
        if (!this.canUndo()) return null;
        return this.commands_[this.index_].description;
    }

    get redoDescription(): string | null {
        if (!this.canRedo()) return null;
        return this.commands_[this.index_ + 1].description;
    }

    get historySize(): number {
        return this.commands_.length;
    }

    get currentIndex(): number {
        return this.index_;
    }
}
