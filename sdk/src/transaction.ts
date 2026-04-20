/**
 * @file    transaction.ts
 * @brief   Undo/redo primitive for editor-driven mutation gestures
 *
 * The editor wraps one user gesture (a property edit, a drag, a paste) in
 * a Transaction. Each op in the transaction carries both its forward and
 * reverse closures so the pair can be replayed in either direction without
 * re-deriving state. TransactionManager holds the undo/redo stacks.
 */

import { log } from './logger';

// =============================================================================
// Types
// =============================================================================

/**
 * A single reversible mutation. `forward` applies the change; `reverse`
 * restores the pre-change state. Both closures are invoked at most once
 * per direction, and the pair is expected to be symmetric.
 */
export interface TransactionOp {
    forward(): void;
    reverse(): void;
}

// =============================================================================
// Transaction
// =============================================================================

export class Transaction {
    readonly id: string;
    readonly label: string;
    readonly timestamp: number;
    private readonly ops_: TransactionOp[] = [];

    constructor(label: string, id?: string) {
        this.id = id ?? genTransactionId();
        this.label = label;
        this.timestamp = Date.now();
    }

    /**
     * Appends an op to this transaction and runs its `forward` closure
     * immediately. Use `addDeferred` if the caller has already applied the
     * mutation and just wants to register a reverse.
     */
    add(op: TransactionOp): void {
        this.ops_.push(op);
        op.forward();
    }

    /**
     * Registers the reverse/forward pair without calling `forward` —
     * caller has already applied the mutation and just wants it undoable.
     */
    addDeferred(op: TransactionOp): void {
        this.ops_.push(op);
    }

    get opCount(): number {
        return this.ops_.length;
    }

    undo(): void {
        // Reverse in LIFO order so ops can legitimately depend on the
        // state left by earlier ops in the same transaction.
        for (let i = this.ops_.length - 1; i >= 0; i--) {
            try {
                this.ops_[i].reverse();
            } catch (e) {
                log.warn('transaction', `undo op ${i} of "${this.label}" threw`, e);
            }
        }
    }

    redo(): void {
        for (let i = 0; i < this.ops_.length; i++) {
            try {
                this.ops_[i].forward();
            } catch (e) {
                log.warn('transaction', `redo op ${i} of "${this.label}" threw`, e);
            }
        }
    }
}

// =============================================================================
// Transaction Manager
// =============================================================================

export interface TransactionManagerOptions {
    /** Hard cap on undo history. Oldest entries drop first. Default: 200. */
    historyLimit?: number;
}

export class TransactionManager {
    private readonly undoStack_: Transaction[] = [];
    private readonly redoStack_: Transaction[] = [];
    private readonly historyLimit_: number;
    private active_: Transaction | null = null;

    constructor(options?: TransactionManagerOptions) {
        this.historyLimit_ = options?.historyLimit ?? 200;
    }

    /**
     * Opens a transaction and returns it. Caller adds ops, then calls
     * `commit(tx)`. Only one transaction is active at a time — nested
     * begins throw, keeping the LIFO invariant clean.
     */
    begin(label: string): Transaction {
        if (this.active_ !== null) {
            throw new Error(
                `TransactionManager.begin("${label}"): transaction "${this.active_.label}" is already open`,
            );
        }
        this.active_ = new Transaction(label);
        return this.active_;
    }

    /**
     * Commits the active transaction onto the undo stack. Empty
     * transactions are dropped silently (keeps the stack uncluttered
     * when a gesture ends up being a no-op).
     */
    commit(tx: Transaction): void {
        if (tx !== this.active_) {
            throw new Error('TransactionManager.commit: transaction is not the active one');
        }
        this.active_ = null;

        if (tx.opCount === 0) return;

        this.undoStack_.push(tx);
        if (this.undoStack_.length > this.historyLimit_) {
            this.undoStack_.shift();
        }
        // Any new mutation invalidates the redo path.
        this.redoStack_.length = 0;
    }

    /**
     * Aborts the active transaction without committing. Ops that have
     * already been `add`-ed are reversed so the world returns to the
     * pre-begin state.
     */
    rollback(tx: Transaction): void {
        if (tx !== this.active_) {
            throw new Error('TransactionManager.rollback: transaction is not the active one');
        }
        this.active_ = null;
        tx.undo();
    }

    undo(): Transaction | null {
        if (this.active_) {
            log.warn('transaction', `undo called while transaction "${this.active_.label}" is open`);
            return null;
        }
        const tx = this.undoStack_.pop();
        if (!tx) return null;
        tx.undo();
        this.redoStack_.push(tx);
        return tx;
    }

    redo(): Transaction | null {
        if (this.active_) {
            log.warn('transaction', `redo called while transaction "${this.active_.label}" is open`);
            return null;
        }
        const tx = this.redoStack_.pop();
        if (!tx) return null;
        tx.redo();
        this.undoStack_.push(tx);
        return tx;
    }

    canUndo(): boolean {
        return this.active_ === null && this.undoStack_.length > 0;
    }

    canRedo(): boolean {
        return this.active_ === null && this.redoStack_.length > 0;
    }

    peekUndo(): Transaction | null {
        return this.undoStack_.length > 0 ? this.undoStack_[this.undoStack_.length - 1] : null;
    }

    peekRedo(): Transaction | null {
        return this.redoStack_.length > 0 ? this.redoStack_[this.redoStack_.length - 1] : null;
    }

    /** Clears both undo and redo stacks. Use on scene load / project switch. */
    clear(): void {
        this.undoStack_.length = 0;
        this.redoStack_.length = 0;
        this.active_ = null;
    }
}

// =============================================================================
// Helpers
// =============================================================================

let nextTxSeq_ = 0;
function genTransactionId(): string {
    nextTxSeq_++;
    return `tx-${Date.now().toString(36)}-${nextTxSeq_.toString(36)}`;
}
