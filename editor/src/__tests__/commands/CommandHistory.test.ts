import { describe, it, expect, beforeEach } from 'vitest';
import { CommandHistory } from '../../commands/CommandHistory';
import { BaseCommand } from '../../commands/Command';
import type { Command } from '../../commands/Command';

class MockCommand extends BaseCommand {
  type = 'mock';
  description = 'Mock command';
  executed = false;
  undone = false;

  execute(): void {
    this.executed = true;
  }

  undo(): void {
    this.undone = true;
  }
}

class MergeableCommand extends BaseCommand {
  type = 'mergeable';
  description = 'Mergeable command';

  constructor(
    public value: number,
    private onExecute?: () => void,
    private onUndo?: () => void
  ) {
    super();
  }

  execute(): void {
    this.onExecute?.();
  }

  undo(): void {
    this.onUndo?.();
  }

  override canMerge(other: Command): boolean {
    return other.type === 'mergeable' && Date.now() - other.timestamp < 1000;
  }

  override merge(other: Command): Command {
    if (other instanceof MergeableCommand) {
      return new MergeableCommand(other.value, this.onExecute, this.onUndo);
    }
    return this;
  }
}

describe('CommandHistory', () => {
  let history: CommandHistory;

  beforeEach(() => {
    history = new CommandHistory(10);
  });

  describe('execute', () => {
    it('should execute and push command', () => {
      const cmd = new MockCommand();
      history.execute(cmd);

      expect(cmd.executed).toBe(true);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
      expect(history.historySize).toBe(1);
    });

    it('should clear redo stack on new command', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();
      const cmd3 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);
      history.undo();

      expect(history.canRedo()).toBe(true);

      history.execute(cmd3);

      expect(history.canRedo()).toBe(false);
      expect(history.historySize).toBe(2);
    });

    it('should merge consecutive mergeable commands', () => {
      const cmd1 = new MergeableCommand(10);
      const cmd2 = new MergeableCommand(20);

      history.execute(cmd1);
      history.execute(cmd2);

      expect(history.historySize).toBe(1);
      expect((history.peekUndo() as MergeableCommand).value).toBe(20);
    });

    it('should not merge non-mergeable commands', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);

      expect(history.historySize).toBe(2);
    });
  });

  describe('undo', () => {
    it('should undo last command', () => {
      const cmd = new MockCommand();
      history.execute(cmd);

      const result = history.undo();

      expect(result).toBe(true);
      expect(cmd.undone).toBe(true);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);
    });

    it('should return false when nothing to undo', () => {
      const result = history.undo();
      expect(result).toBe(false);
    });

    it('should maintain correct index after multiple undos', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();
      const cmd3 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);
      history.execute(cmd3);

      history.undo();
      history.undo();

      expect(history.currentIndex).toBe(0);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(true);
    });
  });

  describe('redo', () => {
    it('should redo undone command', () => {
      let execCount = 0;
      const cmd = new MergeableCommand(10, () => execCount++);

      history.execute(cmd);
      history.undo();

      const result = history.redo();

      expect(result).toBe(true);
      expect(execCount).toBe(2);
      expect(history.canRedo()).toBe(false);
      expect(history.canUndo()).toBe(true);
    });

    it('should return false when nothing to redo', () => {
      const result = history.redo();
      expect(result).toBe(false);
    });

    it('should handle multiple redos', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);
      history.undo();
      history.undo();

      history.redo();
      expect(history.currentIndex).toBe(0);

      history.redo();
      expect(history.currentIndex).toBe(1);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('peek operations', () => {
    it('should peek undo command', () => {
      const cmd = new MockCommand();
      history.execute(cmd);

      expect(history.peekUndo()).toBe(cmd);
    });

    it('should return null when nothing to undo', () => {
      expect(history.peekUndo()).toBeNull();
    });

    it('should peek redo command', () => {
      const cmd = new MockCommand();
      history.execute(cmd);
      history.undo();

      expect(history.peekRedo()).toBe(cmd);
    });

    it('should return null when nothing to redo', () => {
      expect(history.peekRedo()).toBeNull();
    });
  });

  describe('descriptions', () => {
    it('should return undo description', () => {
      const cmd = new MockCommand();
      history.execute(cmd);

      expect(history.undoDescription).toBe('Mock command');
    });

    it('should return null when nothing to undo', () => {
      expect(history.undoDescription).toBeNull();
    });

    it('should return redo description', () => {
      const cmd = new MockCommand();
      history.execute(cmd);
      history.undo();

      expect(history.redoDescription).toBe('Mock command');
    });

    it('should return null when nothing to redo', () => {
      expect(history.redoDescription).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all history', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);

      history.clear();

      expect(history.historySize).toBe(0);
      expect(history.currentIndex).toBe(-1);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('size limit', () => {
    it('should limit history size', () => {
      const maxSize = 5;
      const limitedHistory = new CommandHistory(maxSize);

      for (let i = 0; i < 10; i++) {
        limitedHistory.execute(new MockCommand());
      }

      expect(limitedHistory.historySize).toBe(maxSize);
      expect(limitedHistory.currentIndex).toBe(maxSize - 1);
    });

    it('should maintain undo/redo functionality after size limit', () => {
      const maxSize = 3;
      const limitedHistory = new CommandHistory(maxSize);

      for (let i = 0; i < 5; i++) {
        limitedHistory.execute(new MockCommand());
      }

      expect(limitedHistory.canUndo()).toBe(true);
      limitedHistory.undo();
      expect(limitedHistory.canRedo()).toBe(true);
    });
  });
});
