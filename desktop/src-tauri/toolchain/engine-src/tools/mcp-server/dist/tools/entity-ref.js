export function resolveEntityRef(entity) {
    if (typeof entity === 'number')
        return { id: entity };
    const parsed = Number(entity);
    if (!isNaN(parsed) && Number.isInteger(parsed))
        return { id: parsed };
    return { name: entity };
}
