/**
 * @file    PlatformAdapter.ts
 * @brief   Platform abstraction interface for editor
 */

// =============================================================================
// Types
// =============================================================================

export interface FileDialogOptions {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
    multiple?: boolean;
}

export interface SaveDialogOptions {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
}

// =============================================================================
// PlatformAdapter Interface
// =============================================================================

export interface PlatformAdapter {
    /** Convert a local file path to a URL that can be loaded in the browser */
    convertFilePathToUrl(path: string): string;

    /** Open a file selection dialog */
    openFileDialog(options: FileDialogOptions): Promise<string | null>;

    /** Open a save file dialog */
    openSaveDialog(options: SaveDialogOptions): Promise<string | null>;

    /** Read a text file */
    readTextFile(path: string): Promise<string>;

    /** Write a text file */
    writeTextFile(path: string, content: string): Promise<void>;

    /** Check if a file exists */
    exists(path: string): Promise<boolean>;

    /** Create a directory */
    mkdir(path: string): Promise<void>;

    /** Remove a file or directory */
    remove(path: string): Promise<void>;

    /** Rename a file or directory */
    rename(oldPath: string, newPath: string): Promise<void>;

    /** Join path segments */
    joinPath(...segments: string[]): string;
}

// =============================================================================
// Default Web Implementation
// =============================================================================

export class WebPlatformAdapter implements PlatformAdapter {
    convertFilePathToUrl(path: string): string {
        return `file://${path.replace(/\\/g, '/')}`;
    }

    async openFileDialog(_options: FileDialogOptions): Promise<string | null> {
        console.warn('File dialog not available in web platform');
        return null;
    }

    async openSaveDialog(_options: SaveDialogOptions): Promise<string | null> {
        console.warn('Save dialog not available in web platform');
        return null;
    }

    async readTextFile(_path: string): Promise<string> {
        throw new Error('File reading not available in web platform');
    }

    async writeTextFile(_path: string, _content: string): Promise<void> {
        throw new Error('File writing not available in web platform');
    }

    async exists(_path: string): Promise<boolean> {
        return false;
    }

    async mkdir(_path: string): Promise<void> {
        throw new Error('Directory creation not available in web platform');
    }

    async remove(_path: string): Promise<void> {
        throw new Error('File removal not available in web platform');
    }

    async rename(_oldPath: string, _newPath: string): Promise<void> {
        throw new Error('File renaming not available in web platform');
    }

    joinPath(...segments: string[]): string {
        return segments.join('/').replace(/\/+/g, '/');
    }
}

// =============================================================================
// Global Instance
// =============================================================================

let platformAdapter: PlatformAdapter = new WebPlatformAdapter();

export function setPlatformAdapter(adapter: PlatformAdapter): void {
    platformAdapter = adapter;
}

export function getPlatformAdapter(): PlatformAdapter {
    return platformAdapter;
}
