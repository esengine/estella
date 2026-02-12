export function generateUniqueName(baseName: string, existingNames: Set<string>): string {
    const match = baseName.match(/^(.+)\s*\((\d+)\)$/);
    const coreName = match ? match[1].trimEnd() : baseName;
    let startIndex = match ? parseInt(match[2], 10) + 1 : 1;

    let candidate = `${coreName} (${startIndex})`;
    while (existingNames.has(candidate)) {
        startIndex++;
        candidate = `${coreName} (${startIndex})`;
    }

    return candidate;
}
