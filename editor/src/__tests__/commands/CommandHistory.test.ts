import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandHistory } from '../../commands/CommandHistory';
import { BaseCommand } from '../../commands/Command';
import { CompoundCommand } from '../../commands/CompoundCommand';
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

class StructuralMockCommand extends BaseCommand {
  type = 'structural_mock';
  description = 'Structural mock command';
  readonly structural = true;
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

class CountingCommand extends BaseCommand {
  type = 'counting';
  description = 'Counting command';
  static executeCount = 0;
  static undoCount = 0;

  execute(): void {
    CountingCommand.executeCount++;
  }

  undo(): void {
    CountingCommand.undoCount++;
  }

  static reset(): void {
    CountingCommand.executeCount = 0;
    CountingCommand.undoCount = 0;
  }
}

describe('CommandHistory', () => {
  let history: CommandHistory;

  beforeEach(() => {
    history = new CommandHistory(10);
    CountingCommand.reset();
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

    it('should not merge different command types', () => {
      const cmd1 = new MergeableCommand(10);
      const cmd2 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);

      expect(history.historySize).toBe(2);
    });

    it('should merge multiple consecutive mergeable commands into one', () => {
      const cmd1 = new MergeableCommand(10);
      const cmd2 = new MergeableCommand(20);
      const cmd3 = new MergeableCommand(30);
      const cmd4 = new MergeableCommand(40);

      history.execute(cmd1);
      history.execute(cmd2);
      history.execute(cmd3);
      history.execute(cmd4);

      expect(history.historySize).toBe(1);
      expect((history.peekUndo() as MergeableCommand).value).toBe(40);
    });

    it('should execute all commands even when merging', () => {
      let execCount = 0;
      const cmd1 = new MergeableCommand(10, () => execCount++);
      const cmd2 = new MergeableCommand(20, () => execCount++);

      history.execute(cmd1);
      history.execute(cmd2);

      expect(execCount).toBe(2);
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

    it('should undo all commands to empty state', () => {
      history.execute(new MockCommand());
      history.execute(new MockCommand());
      history.execute(new MockCommand());

      history.undo();
      history.undo();
      history.undo();

      expect(history.canUndo()).toBe(false);
      expect(history.currentIndex).toBe(-1);
    });

    it('should not go below index -1', () => {
      history.undo();
      history.undo();

      expect(history.currentIndex).toBe(-1);
      expect(history.canUndo()).toBe(false);
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

    it('should redo commands in forward order', () => {
      const order: number[] = [];

      history.execute(new CountingCommand());
      history.execute(new CountingCommand());
      history.execute(new CountingCommand());

      history.undo();
      history.undo();
      history.undo();

      CountingCommand.reset();

      history.redo();
      expect(CountingCommand.executeCount).toBe(1);

      history.redo();
      expect(CountingCommand.executeCount).toBe(2);

      history.redo();
      expect(CountingCommand.executeCount).toBe(3);
    });
  });

  describe('undo/redo interleaving', () => {
    it('should handle undo then redo then new command', () => {
      history.execute(new MockCommand());
      history.execute(new MockCommand());
      history.execute(new MockCommand());

      history.undo();
      history.redo();

      expect(history.historySize).toBe(3);
      expect(history.currentIndex).toBe(2);
    });

    it('should discard redo stack when executing after undo', () => {
      history.execute(new MockCommand());
      history.execute(new MockCommand());
      history.execute(new MockCommand());

      history.undo();
      history.undo();

      history.execute(new MockCommand());

      expect(history.historySize).toBe(2);
      expect(history.canRedo()).toBe(false);
    });

    it('should handle undo-redo-undo cycle', () => {
      const cmd = new MockCommand();
      history.execute(cmd);

      history.undo();
      expect(cmd.undone).toBe(true);

      history.redo();
      history.undo();

      expect(history.currentIndex).toBe(-1);
      expect(history.canRedo()).toBe(true);
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

    it('should peek correct command after multiple operations', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();
      const cmd3 = new MockCommand();

      history.execute(cmd1);
      history.execute(cmd2);
      history.execute(cmd3);

      history.undo();

      expect(history.peekUndo()).toBe(cmd2);
      expect(history.peekRedo()).toBe(cmd3);
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

    it('should clear redo stack too', () => {
      history.execute(new MockCommand());
      history.execute(new MockCommand());
      history.undo();

      expect(history.canRedo()).toBe(true);

      history.clear();

      expect(history.canRedo()).toBe(false);
      expect(history.historySize).toBe(0);
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

    it('should discard oldest commands when limit exceeded', () => {
      const maxSize = 3;
      const limitedHistory = new CommandHistory(maxSize);
      const commands: MockCommand[] = [];

      for (let i = 0; i < 5; i++) {
        const cmd = new MockCommand();
        cmd.description = `Command ${i}`;
        commands.push(cmd);
        limitedHistory.execute(cmd);
      }

      limitedHistory.undo();
      limitedHistory.undo();

      expect(limitedHistory.peekUndo()?.description).toBe('Command 2');
    });

    it('should use default max size of 100', () => {
      const defaultHistory = new CommandHistory();

      for (let i = 0; i < 150; i++) {
        defaultHistory.execute(new MockCommand());
      }

      expect(defaultHistory.historySize).toBe(100);
    });
  });

  describe('compound commands', () => {
    it('should execute compound command as single undo unit', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();
      const compound = new CompoundCommand([cmd1, cmd2], 'Compound op');

      history.execute(compound);

      expect(cmd1.executed).toBe(true);
      expect(cmd2.executed).toBe(true);
      expect(history.historySize).toBe(1);
    });

    it('should undo compound command in reverse order', () => {
      const order: number[] = [];
      const cmd1 = new MergeableCommand(1, undefined, () => order.push(1));
      const cmd2 = new MergeableCommand(2, undefined, () => order.push(2));
      const compound = new CompoundCommand([cmd1, cmd2], 'Compound op');

      history.execute(compound);
      history.undo();

      expect(order).toEqual([2, 1]);
    });

    it('should mark compound as structural if any child is structural', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new StructuralMockCommand();
      const compound = new CompoundCommand([cmd1, cmd2], 'Mixed compound');

      expect(compound.structural).toBe(true);
    });

    it('should not be structural if no children are structural', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();
      const compound = new CompoundCommand([cmd1, cmd2], 'Non-structural compound');

      expect(compound.structural).toBe(false);
    });

    it('should have correct description', () => {
      const compound = new CompoundCommand([new MockCommand()], 'My description');

      history.execute(compound);

      expect(history.undoDescription).toBe('My description');
    });

    it('should redo compound command correctly', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();
      const compound = new CompoundCommand([cmd1, cmd2], 'Compound op');

      history.execute(compound);
      history.undo();
      history.redo();

      expect(history.historySize).toBe(1);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('structural flag', () => {
    it('should identify structural commands', () => {
      const cmd = new StructuralMockCommand();
      expect(cmd.structural).toBe(true);
    });

    it('should default structural to false', () => {
      const cmd = new MockCommand();
      expect(cmd.structural).toBe(false);
    });
  });

  describe('command identity', () => {
    it('should assign unique ids to commands', () => {
      const cmd1 = new MockCommand();
      const cmd2 = new MockCommand();

      expect(cmd1.id).not.toBe(cmd2.id);
    });

    it('should record timestamp on creation', () => {
      const before = Date.now();
      const cmd = new MockCommand();
      const after = Date.now();

      expect(cmd.timestamp).toBeGreaterThanOrEqual(before);
      expect(cmd.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
