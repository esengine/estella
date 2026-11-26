---
section: Fixed
commits:
  - fix(editor): keep large string tables responsive and save translations to the intended file
---
**Large string tables stay responsive while you search, scroll and edit translations.** You can search or page through entries in the asset inspector and keep a draft while scrolling the table. Both panels share saved edits, and Play and export wait for pending translation saves. If a language spans several files, the editor counts missing translations using the same text the game displays. Spreadsheet and XLIFF exports identify each file, and large imports reach the review step faster.
