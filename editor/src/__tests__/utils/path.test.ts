import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  joinPath,
  getFileExtension,
  getDirName,
  getParentDir,
  isAbsolutePath,
} from '../../utils/path';

describe('Path utilities', () => {
  describe('normalizePath', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('assets\\textures\\sprite.png')).toBe('assets/textures/sprite.png');
    });

    it('should handle mixed slashes', () => {
      expect(normalizePath('assets/textures\\images/sprite.png')).toBe('assets/textures/images/sprite.png');
    });

    it('should handle paths with no backslashes', () => {
      expect(normalizePath('assets/textures/sprite.png')).toBe('assets/textures/sprite.png');
    });
  });

  describe('joinPath', () => {
    it('should join paths correctly', () => {
      expect(joinPath('assets', 'textures', 'sprite.png')).toBe('assets/textures/sprite.png');
    });

    it('should handle trailing slashes', () => {
      expect(joinPath('assets/', 'textures/', 'sprite.png')).toBe('assets/textures/sprite.png');
    });

    it('should handle leading slashes', () => {
      expect(joinPath('/assets', 'textures', 'sprite.png')).toBe('/assets/textures/sprite.png');
    });

    it('should handle multiple slashes', () => {
      expect(joinPath('assets//', 'textures', 'sprite.png')).toBe('assets/textures/sprite.png');
    });

    it('should handle empty parts', () => {
      expect(joinPath('assets', '', 'sprite.png')).toBe('assets/sprite.png');
    });

    it('should handle single part', () => {
      expect(joinPath('assets')).toBe('assets');
    });
  });

  describe('getFileExtension', () => {
    it('should extract file extension', () => {
      expect(getFileExtension('sprite.png')).toBe('png');
    });

    it('should return lowercase extension', () => {
      expect(getFileExtension('sprite.PNG')).toBe('png');
    });

    it('should handle multiple dots', () => {
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
    });

    it('should return empty string for no extension', () => {
      expect(getFileExtension('filename')).toBe('');
    });

    it('should return empty string for hidden files', () => {
      expect(getFileExtension('.gitignore')).toBe('');
    });

    it('should handle paths with directories', () => {
      expect(getFileExtension('assets/textures/sprite.png')).toBe('png');
    });
  });

  describe('getDirName', () => {
    it('should extract directory name', () => {
      expect(getDirName('assets/textures/sprite.png')).toBe('assets/textures');
    });

    it('should handle nested paths', () => {
      expect(getDirName('a/b/c/d.txt')).toBe('a/b/c');
    });

    it('should return empty for file in root', () => {
      expect(getDirName('sprite.png')).toBe('');
    });

    it('should handle root slash', () => {
      expect(getDirName('/sprite.png')).toBe('');
    });
  });

  describe('getParentDir', () => {
    it('should extract parent directory', () => {
      expect(getParentDir('assets/textures/sprites')).toBe('assets/textures');
    });

    it('should handle file paths', () => {
      expect(getParentDir('assets/textures/sprite.png')).toBe('assets/textures');
    });

    it('should normalize backslashes', () => {
      expect(getParentDir('assets\\textures\\sprite.png')).toBe('assets/textures');
    });

    it('should handle single directory', () => {
      expect(getParentDir('assets')).toBe('assets');
    });

    it('should handle root paths', () => {
      expect(getParentDir('/assets')).toBe('/assets');
    });
  });

  describe('isAbsolutePath', () => {
    it('should recognize unix absolute paths', () => {
      expect(isAbsolutePath('/usr/local/bin')).toBe(true);
    });

    it('should recognize windows absolute paths', () => {
      expect(isAbsolutePath('C:/Users/test')).toBe(true);
      expect(isAbsolutePath('D:\\Projects')).toBe(true);
    });

    it('should recognize relative paths', () => {
      expect(isAbsolutePath('assets/textures')).toBe(false);
      expect(isAbsolutePath('./assets')).toBe(false);
      expect(isAbsolutePath('../assets')).toBe(false);
    });
  });
});
