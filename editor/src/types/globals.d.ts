/**
 * @file    globals.d.ts
 * @brief   Global type declarations for editor
 */

interface FileStat {
    size: number;
    mtimeMs: number;
    isDirectory: boolean;
    isFile: boolean;
}

interface DirectoryEntry {
    name: string;
    isDirectory: boolean;
}

interface OpenDialogOptions {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: string[];
}

interface NativeFileSystem {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<Uint8Array>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    writeFile(path: string, content: Uint8Array | string): Promise<boolean>;
    writeBinaryFile(path: string, data: Uint8Array): Promise<boolean>;
    copyFile(src: string, dest: string): Promise<boolean>;
    unlink(path: string): Promise<void>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<FileStat>;
    createDirectory(path: string): Promise<boolean>;
    listDirectoryDetailed(path: string): Promise<DirectoryEntry[]>;
    showOpenDialog(options: OpenDialogOptions): Promise<string[] | null>;
    openFolder(path: string): Promise<void>;
    openFile(path: string): Promise<void>;
    getEngineWxgameJs(): Promise<string>;
    getEngineWxgameWasm(): Promise<Uint8Array>;
    getSdkWechatJs(): Promise<string>;
}
