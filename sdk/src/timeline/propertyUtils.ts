export function setNestedProperty(obj: Record<string, any>, path: string, value: number): boolean {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target == null || typeof target !== 'object') return false;
    }
    const lastKey = parts[parts.length - 1];
    if (!(lastKey in target)) return false;
    target[lastKey] = value;
    return true;
}

export function getNestedProperty(obj: Record<string, any>, path: string): number | undefined {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]];
        if (target == null || typeof target !== 'object') return undefined;
    }
    const value = target[parts[parts.length - 1]];
    return typeof value === 'number' ? value : undefined;
}
