---
section: Fixed
commits:
  - fix(assets): a bitmap font that came in through an import keeps its page in a build - the one table every .meta is minted from wrote bitmapFont for .fnt and .bmfont, while the cook and the editor read bitmapfont, so a font imported or adopted from disk was never scanned for the page image it names and the build culled it
---
**A bitmap font brought into a project through an import keeps its page image in a build.** Importing a `.fnt` or `.bmfont`, or letting the editor adopt one found on disk, wrote its `.meta` type as `bitmapFont` while the build and the editor read `bitmapfont`, so the build never looked inside the font for the page it names and left the page out: the font drew nothing in the shipped game. New imports write `bitmapfont`, and a `.meta` already written the old way is read correctly without being rewritten. A `.esterrain` file now gets a `.meta` when it is imported or found on disk.
