// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    webCacheStore.ts
 * @brief   The browser's content cache: files by name in IndexedDB, behind the platform's cache-file methods.
 *
 * @details The content cache holds bytes that never go stale (a key says what the bytes are). A browser keeps what a page
 *          downloads itself, but not what the page makes: a texture drawn from its recipe is made again every visit unless it is
 *          kept here. Entries are stored under the cache's own file names (cacheEntryName), with the time each was last read.
 */

const DATABASE = 'estella-content-cache';
const STORE = 'files';

interface Stored { bytes: ArrayBuffer; size: number; lastAccess: number }

let opening: Promise<IDBDatabase> | null = null;

/** Whether this browser has a store at all (a worker-less or storage-less realm has none). */
export function webCacheAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

function database(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { opening = null; reject(request.error ?? new Error('the content cache cannot be opened')); };
        request.onblocked = () => { opening = null; reject(new Error('the content cache is held by another page')); };
    });
    return opening;
}

/** One request against the store, settled when its transaction is. */
async function ask<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database();
    return new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error ?? new Error('the content cache refused a request'));
        transaction.onabort = () => reject(transaction.error ?? new Error('the content cache gave up a request'));
    });
}

export async function webCacheRead(name: string): Promise<ArrayBuffer | null> {
    const entry = await ask<Stored | undefined>('readonly', (s) => s.get(name) as IDBRequest<Stored | undefined>);
    return entry ? entry.bytes : null;
}

export async function webCacheWrite(name: string, bytes: ArrayBuffer): Promise<void> {
    await ask('readwrite', (s) => s.put({ bytes, size: bytes.byteLength, lastAccess: Date.now() } satisfies Stored, name));
}

export async function webCacheList(): Promise<{ name: string; size: number; lastAccess: number }[]> {
    const db = await database();
    return new Promise((resolve, reject) => {
        const out: { name: string; size: number; lastAccess: number }[] = [];
        const transaction = db.transaction(STORE, 'readonly');
        const cursor = transaction.objectStore(STORE).openCursor();
        cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) return;
            const entry = at.value as Stored;
            out.push({ name: String(at.key), size: entry.size, lastAccess: entry.lastAccess });
            at.continue();
        };
        transaction.oncomplete = () => resolve(out);
        transaction.onerror = () => reject(transaction.error ?? new Error('the content cache cannot be listed'));
    });
}

export async function webCacheRemove(name: string): Promise<void> {
    await ask('readwrite', (s) => s.delete(name));
}
