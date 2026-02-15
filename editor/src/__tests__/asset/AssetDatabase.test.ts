import { describe, it, expect } from 'vitest';
import { isUUID } from '../../asset/AssetDatabase';

describe('AssetDatabase utilities', () => {
  describe('isUUID', () => {
    it('should recognize valid UUIDs', () => {
      expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
      expect(isUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should recognize uppercase UUIDs', () => {
      expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isUUID('not-a-uuid')).toBe(false);
      expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isUUID('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
      expect(isUUID('550e8400-e29b-41d4-a716-4466554400000')).toBe(false);
      expect(isUUID('550e8400e29b41d4a716446655440000')).toBe(false);
      expect(isUUID('')).toBe(false);
    });

    it('should reject UUIDs with invalid characters', () => {
      expect(isUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
      expect(isUUID('550e8400-e29b-41d4-a716-44665544000 ')).toBe(false);
    });
  });
});
