export interface FuzzyMatch {
  score: number;
  matches: number[];
}

export function fuzzyMatch(pattern: string, text: string): FuzzyMatch | null {
  if (!pattern) {
    return { score: 0, matches: [] };
  }

  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();

  let score = 0;
  let patternIdx = 0;
  const matches: number[] = [];

  for (let i = 0; i < textLower.length; i++) {
    if (patternIdx >= patternLower.length) break;

    if (textLower[i] === patternLower[patternIdx]) {
      matches.push(i);

      if (matches.length > 1 && matches[matches.length - 1] === matches[matches.length - 2] + 1) {
        score += 5;
      }

      if (i === 0 || textLower[i - 1] === ' ' || textLower[i - 1] === '_') {
        score += 10;
      }

      if (text[i] === text[i].toUpperCase() && i > 0 && text[i - 1] === text[i - 1].toLowerCase()) {
        score += 8;
      }

      score += 1;
      patternIdx++;
    }
  }

  if (patternIdx < patternLower.length) {
    return null;
  }

  return { score, matches };
}

export function fuzzyFilter<T>(
  items: T[],
  pattern: string,
  getText: (item: T) => string
): Array<{ item: T; match: FuzzyMatch }> {
  if (!pattern) {
    return items.map(item => ({ item, match: { score: 0, matches: [] } }));
  }

  const results: Array<{ item: T; match: FuzzyMatch }> = [];

  for (const item of items) {
    const text = getText(item);
    const match = fuzzyMatch(pattern, text);
    if (match) {
      results.push({ item, match });
    }
  }

  results.sort((a, b) => b.match.score - a.match.score);

  return results;
}
