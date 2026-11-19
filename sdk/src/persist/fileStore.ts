// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fileStore.ts
 * @brief   A {@link PersistStore} over a directory, for a server that runs as
 *          one process on one machine. One JSON file per key, replaced whole
 *          by writing a temporary file and renaming it over, so a crash leaves
 *          the old document or the new one and never half of either.
 *
 *          A transaction is written to a journal first and then applied, so a
 *          crash part-way through is finished when the store is next opened.
 *
 *          Versioned writes are atomic within this process only. Two
 *          processes sharing a directory can overwrite each other; put a
 *          `StoreHub` in front of one store and give the processes a
 *          `RemoteStore` each, or use a database store.
 */
import { checkDistinctKeys, checkVersion, type PersistOp, type PersistStore, type PersistWriteOptions, type StoredDocument } from './store';

/** What the journal holds: every write of one transaction, as it will be on disk. */
interface Journal {
    ops: { key: string; version: number; value?: unknown; delete?: true }[];
}

/** The journal's own directory: its files are not keys. */
const JOURNAL_DIR = '.txn';

type Fs = typeof import('node:fs/promises');

/** Temporary file names are unique across every store in the process, and across processes by a random tag. */
let tmpSeq = 0;
const tmpTag = Math.random().toString(36).slice(2, 10);
type PathMod = typeof import('node:path');

/**
 * A key as a file name that means the same on every file system: anything but
 * lower-case letters, digits, `-`, `_` and `.` becomes `%XX`, so keys that
 * differ only in case stay apart on Windows and macOS too.
 */
function fileNameOf(key: string): string {
    let out = '';
    for (const byte of new TextEncoder().encode(key)) {
        const c = String.fromCharCode(byte);
        out += /[a-z0-9\-_.]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return `${out}.json`;
}

function keyOf(fileName: string): string | null {
    if (!fileName.endsWith('.json')) return null;
    try {
        return decodeURIComponent(fileName.slice(0, -'.json'.length));
    } catch {
        return null;
    }
}

/**
 * Replace `file` with `tmp`. On Windows a rename over a file that another
 * handle has open (a reader, an indexer, a virus scanner) fails for a moment
 * with EPERM, EBUSY or EACCES; it is retried briefly rather than lost.
 */
async function renameOver(fs: Fs, tmp: string, file: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.rename(tmp, file);
            return;
        } catch (err) {
            const code = (err as { code?: string }).code;
            const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
            if (!transient || attempt >= 20) {
                await fs.rm(tmp, { force: true }).catch(() => undefined);
                throw err;
            }
            await new Promise((r) => setTimeout(r, Math.min(5 * (attempt + 1), 50)));
        }
    }
}

export class FileStore implements PersistStore {
    private fs_: Fs | null = null;
    private path_: PathMod | null = null;
    private ready_: Promise<void> | null = null;
    /** One operation at a time per key, so read-check-write cannot interleave. */
    private readonly queue_ = new Map<string, Promise<unknown>>();

    constructor(private readonly dir: string) {}

    private async init_(): Promise<{ fs: Fs; path: PathMod }> {
        // Loaded on first use, so importing the persist module costs a browser
        // build nothing; only a store that touches disk needs Node.
        this.ready_ ??= (async () => {
            this.fs_ = await import('node:fs/promises');
            this.path_ = await import('node:path');
            await this.fs_.mkdir(this.path_.join(this.dir, JOURNAL_DIR), { recursive: true });
            await this.recover_();
        })();
        await this.ready_;
        return { fs: this.fs_!, path: this.path_! };
    }

    private serial_<R>(key: string, op: () => Promise<R>): Promise<R> {
        const prev = this.queue_.get(key) ?? Promise.resolve();
        const next = prev.then(op, op);
        const tail = next.catch(() => undefined);
        this.queue_.set(key, tail);
        void tail.then(() => { if (this.queue_.get(key) === tail) this.queue_.delete(key); });
        return next;
    }

    /** Finish every transaction a crash left in the journal: its writes are whole values, so applying them again is safe. */
    private async recover_(): Promise<void> {
        const fs = this.fs_!;
        const path = this.path_!;
        const dir = path.join(this.dir, JOURNAL_DIR);
        for (const name of await fs.readdir(dir)) {
            const file = path.join(dir, name);
            if (!name.endsWith('.json')) { await fs.rm(file, { force: true }); continue; }
            let journal: Journal;
            try {
                journal = JSON.parse(await fs.readFile(file, 'utf8')) as Journal;
            } catch {
                // A journal cut short was never committed: nothing of it was applied.
                await fs.rm(file, { force: true });
                continue;
            }
            await this.apply_(journal);
            await fs.rm(file, { force: true });
        }
    }

    private async writeDoc_(key: string, version: number, value: unknown): Promise<void> {
        const fs = this.fs_!;
        const file = this.path_!.join(this.dir, fileNameOf(key));
        const tmp = `${file}.${tmpTag}.${++tmpSeq}.tmp`;
        await fs.writeFile(tmp, JSON.stringify({ version, value }), 'utf8');
        await renameOver(fs, tmp, file);
    }

    private async apply_(journal: Journal): Promise<void> {
        for (const op of journal.ops) {
            if (op.delete) await this.fs_!.rm(this.path_!.join(this.dir, fileNameOf(op.key)), { force: true });
            else await this.writeDoc_(op.key, op.version, op.value);
        }
    }

    /** Run `op` once every key in `keys` is free, and hold them all until it is done. */
    private serialMany_<R>(keys: readonly string[], op: () => Promise<R>): Promise<R> {
        const prev = Promise.all(keys.map((k) => this.queue_.get(k) ?? Promise.resolve()));
        const next = prev.then(op, op);
        const tail = next.catch(() => undefined);
        for (const k of keys) this.queue_.set(k, tail);
        void tail.then(() => { for (const k of keys) if (this.queue_.get(k) === tail) this.queue_.delete(k); });
        return next;
    }

    transact(ops: readonly PersistOp[]): Promise<number[]> {
        try { checkDistinctKeys(ops); } catch (err) { return Promise.reject(err); }
        return this.serialMany_(ops.map((o) => o.key), async () => {
            const { fs, path } = await this.init_();
            const journal: Journal = { ops: [] };
            const versions: number[] = [];
            for (const op of ops) {
                const current = (await this.read_(op.key))?.version ?? 0;
                checkVersion(op.key, op.expectVersion, current);
                if ('delete' in op) {
                    journal.ops.push({ key: op.key, version: 0, delete: true });
                    versions.push(0);
                } else {
                    if (JSON.stringify(op.value) === undefined) throw new Error(`[persist] "${op.key}": the value is not JSON`);
                    journal.ops.push({ key: op.key, version: current + 1, value: op.value });
                    versions.push(current + 1);
                }
            }
            // Committed once the journal is on disk; applied after.
            const file = path.join(this.dir, JOURNAL_DIR, `${Date.now().toString(36)}-${tmpTag}-${++tmpSeq}.json`);
            const tmp = `${file}.tmp`;
            await fs.writeFile(tmp, JSON.stringify(journal), 'utf8');
            await renameOver(fs, tmp, file);
            await this.apply_(journal);
            await fs.rm(file, { force: true });
            return versions;
        });
    }

    private async read_(key: string): Promise<{ value: unknown; version: number } | null> {
        const { fs, path } = await this.init_();
        try {
            const text = await fs.readFile(path.join(this.dir, fileNameOf(key)), 'utf8');
            return JSON.parse(text) as { value: unknown; version: number };
        } catch (err) {
            if ((err as { code?: string }).code === 'ENOENT') return null;
            throw err;
        }
    }

    get<T = unknown>(key: string): Promise<StoredDocument<T> | null> {
        return this.serial_(key, async () => {
            const doc = await this.read_(key);
            return doc ? { value: doc.value as T, version: doc.version } : null;
        });
    }

    put<T = unknown>(key: string, value: T, options: PersistWriteOptions = {}): Promise<number> {
        return this.serial_(key, async () => {
            const { fs, path } = await this.init_();
            const current = (await this.read_(key))?.version ?? 0;
            checkVersion(key, options.expectVersion, current);
            const json = JSON.stringify({ version: current + 1, value });
            if (json === undefined) throw new Error(`[persist] "${key}": the value is not JSON`);
            const file = path.join(this.dir, fileNameOf(key));
            const tmp = `${file}.${tmpTag}.${++tmpSeq}.tmp`;
            await fs.writeFile(tmp, json, 'utf8');
            await renameOver(fs, tmp, file);
            return current + 1;
        });
    }

    delete(key: string, options: PersistWriteOptions = {}): Promise<boolean> {
        return this.serial_(key, async () => {
            const { fs, path } = await this.init_();
            const doc = await this.read_(key);
            checkVersion(key, options.expectVersion, doc?.version ?? 0);
            if (!doc) return false;
            await fs.rm(path.join(this.dir, fileNameOf(key)), { force: true });
            return true;
        });
    }

    async keys(prefix = ''): Promise<string[]> {
        const { fs } = await this.init_();
        const out: string[] = [];
        for (const name of await fs.readdir(this.dir)) {
            const key = keyOf(name);
            if (key !== null && key.startsWith(prefix)) out.push(key);
        }
        return out;
    }
}
