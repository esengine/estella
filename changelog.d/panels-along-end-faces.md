---
section: Fixed
commits:
  - fix(modeling): panels cuts a face that is square to along - a panels step given along projected that direction onto each face to line the seams up, and where the face's normal ran with it there was nothing left to line up with, so the face was passed through uncut and unreported: a hull panelled along its length kept bare end faces. Such a face is now cut by its longest edge, the rule a step without along already uses
---
**`panels` cuts the faces that are square to `along`.** A `panels` step given `along` left every face whose normal ran with that direction as it was, without a word: a hull panelled along its length kept bare end faces. Such a face is now cut by its longest edge, as a step with no `along` cuts it.
