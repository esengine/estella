export function resolveEntityRef(entity: number | string): { id: number } | { name: string } {
    if (typeof entity === 'number') return { id: entity };
    const parsed = Number(entity);
    if (!isNaN(parsed) && Number.isInteger(parsed)) return { id: parsed };
    return { name: entity };
}
