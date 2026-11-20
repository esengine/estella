---
section: Fixed
commits:
  - fix(render): a draw whose program is compiling draws with the preview program, and a prepass it missed does not hide it
  - fix(editor): open progress names the programs compiling and the draws waiting for them
---
**A large scene opens whole instead of filling in for seconds.** While its shaders compiled in the background, Bistro's restaurant was missing for several seconds after the scene appeared, and the canal behind it showed through, as if the view had jumped when the restaurant finally drew. Three things caused it:
- 235 of the scene's 645 draws were left out until their program was ready.
- The program a draw fell back to wrote no surface record, so post effects treated those pixels as empty.
- A draw that missed the depth prepass was then tested against depth it had never written.

Now a mesh whose own program is still compiling draws with a small preview program that is compiled at once: its texture, colour and bake, with a full surface record. Its real shading takes over the frame its program is ready, and the restaurant shows about 5 seconds after the open began, not 8 to 11.
