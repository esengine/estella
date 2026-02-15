import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyFilter } from '../../utils/fuzzy';

describe('Fuzzy matching', () => {
  describe('fuzzyMatch', () => {
    it('should match exact strings', () => {
      const result = fuzzyMatch('test', 'test');
      expect(result).not.toBeNull();
      expect(result!.matches).toEqual([0, 1, 2, 3]);
    });

    it('should match partial strings', () => {
      const result = fuzzyMatch('plyr', 'PlayerController');
      expect(result).not.toBeNull();
      expect(result!.matches.length).toBe(4);
    });

    it('should be case insensitive', () => {
      const result = fuzzyMatch('PC', 'PlayerController');
      expect(result).not.toBeNull();
      expect(result!.matches).toEqual([0, 6]);
    });

    it('should score consecutive matches higher', () => {
      const consecutive = fuzzyMatch('play', 'PlayerController');
      const scattered = fuzzyMatch('plyr', 'PlayerController');
      expect(consecutive!.score).toBeGreaterThan(scattered!.score);
    });

    it('should score word boundary matches higher', () => {
      const wordBoundary = fuzzyMatch('pc', 'Player Controller');
      const middle = fuzzyMatch('pc', 'SpecialCamera');
      expect(wordBoundary!.score).toBeGreaterThan(middle!.score);
    });

    it('should score camelCase matches higher', () => {
      const camelCase = fuzzyMatch('pc', 'PlayerController');
      const lowercase = fuzzyMatch('pc', 'playercontroller');
      expect(camelCase!.score).toBeGreaterThan(lowercase!.score);
    });

    it('should return null for non-matching patterns', () => {
      const result = fuzzyMatch('xyz', 'PlayerController');
      expect(result).toBeNull();
    });

    it('should return null for incomplete patterns', () => {
      const result = fuzzyMatch('playerz', 'Player');
      expect(result).toBeNull();
    });

    it('should handle empty pattern', () => {
      const result = fuzzyMatch('', 'test');
      expect(result).toEqual({ score: 0, matches: [] });
    });

    it('should match underscores as word boundaries', () => {
      const result = fuzzyMatch('pc', 'player_controller');
      expect(result).not.toBeNull();
      expect(result!.matches).toEqual([0, 7]);
    });
  });

  describe('fuzzyFilter', () => {
    interface TestItem {
      id: number;
      name: string;
    }

    const items: TestItem[] = [
      { id: 1, name: 'PlayerController' },
      { id: 2, name: 'EnemyController' },
      { id: 3, name: 'CameraController' },
      { id: 4, name: 'Player' },
      { id: 5, name: 'SpecialPlayer' },
    ];

    it('should filter items by pattern', () => {
      const results = fuzzyFilter(items, 'play', item => item.name);
      expect(results.length).toBe(3);
      expect(results.map(r => r.item.id)).toContain(1);
      expect(results.map(r => r.item.id)).toContain(4);
      expect(results.map(r => r.item.id)).toContain(5);
    });

    it('should sort results by score', () => {
      const results = fuzzyFilter(items, 'ctrl', item => item.name);
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].match.score).toBeGreaterThanOrEqual(results[i].match.score);
      }
    });

    it('should return all items for empty pattern', () => {
      const results = fuzzyFilter(items, '', item => item.name);
      expect(results.length).toBe(items.length);
    });

    it('should return empty array for non-matching pattern', () => {
      const results = fuzzyFilter(items, 'xyz', item => item.name);
      expect(results.length).toBe(0);
    });

    it('should handle single character patterns', () => {
      const results = fuzzyFilter(items, 'p', item => item.name);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
