interface ShortcutBinding {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    key: string;
    action: () => void;
}

export class ShortcutManager {
    private bindings_: ShortcutBinding[] = [];
    private handler_: ((e: KeyboardEvent) => void) | null = null;

    register(shortcut: string, action: () => void): () => void {
        const binding = this.parseShortcut(shortcut, action);
        this.bindings_.push(binding);
        return () => {
            const idx = this.bindings_.indexOf(binding);
            if (idx >= 0) this.bindings_.splice(idx, 1);
        };
    }

    attach(): void {
        if (this.handler_) return;
        this.handler_ = (e: KeyboardEvent) => this.handleKeyDown(e);
        document.addEventListener('keydown', this.handler_);
    }

    detach(): void {
        if (this.handler_) {
            document.removeEventListener('keydown', this.handler_);
            this.handler_ = null;
        }
    }

    handleKeyDown(e: KeyboardEvent): boolean {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;
        const key = e.key === ' ' ? 'space' : e.key.toLowerCase();

        const inTextInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (inTextInput && !ctrl && !alt) {
            return false;
        }

        for (const binding of this.bindings_) {
            if (binding.ctrl === ctrl &&
                binding.shift === shift &&
                binding.alt === alt &&
                binding.key === key) {
                e.preventDefault();
                binding.action();
                return true;
            }
        }
        return false;
    }

    private parseShortcut(shortcut: string, action: () => void): ShortcutBinding {
        const parts = shortcut.toLowerCase().split('+').map(s => s.trim());
        return {
            ctrl: parts.includes('ctrl') || parts.includes('cmd'),
            shift: parts.includes('shift'),
            alt: parts.includes('alt'),
            key: parts[parts.length - 1],
            action,
        };
    }
}
