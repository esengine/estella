import { describe, it, expect } from 'vitest';
import { generateUniqueName } from '../../utils/naming';

describe('generateUniqueName', () => {
  it('should append (1) when base name exists', () => {
    const existing = new Set(['Entity']);
    const result = generateUniqueName('Entity', existing);
    expect(result).toBe('Entity (1)');
  });

  it('should increment number when numbered name exists', () => {
    const existing = new Set(['Entity', 'Entity (1)']);
    const result = generateUniqueName('Entity', existing);
    expect(result).toBe('Entity (2)');
  });

  it('should continue from existing number', () => {
    const existing = new Set(['Entity', 'Entity (1)', 'Entity (2)']);
    const result = generateUniqueName('Entity (1)', existing);
    expect(result).toBe('Entity (3)');
  });

  it('should handle gaps in numbering', () => {
    const existing = new Set(['Entity', 'Entity (2)']);
    const result = generateUniqueName('Entity', existing);
    expect(result).toBe('Entity (1)');
  });

  it('should handle names with spaces', () => {
    const existing = new Set(['Player Controller']);
    const result = generateUniqueName('Player Controller', existing);
    expect(result).toBe('Player Controller (1)');
  });

  it('should handle names already with parentheses', () => {
    const existing = new Set(['Item (Weapon)', 'Item (Weapon) (1)']);
    const result = generateUniqueName('Item (Weapon)', existing);
    expect(result).toBe('Item (Weapon) (2)');
  });

  it('should find next available number in sequence', () => {
    const existing = new Set([
      'Node',
      'Node (1)',
      'Node (2)',
      'Node (3)',
      'Node (5)',
    ]);
    const result = generateUniqueName('Node', existing);
    expect(result).toBe('Node (4)');
  });

  it('should handle empty set', () => {
    const existing = new Set<string>();
    const result = generateUniqueName('Entity', existing);
    expect(result).toBe('Entity (1)');
  });

  it('should preserve case', () => {
    const existing = new Set(['MyEntity']);
    const result = generateUniqueName('MyEntity', existing);
    expect(result).toBe('MyEntity (1)');
  });
});
