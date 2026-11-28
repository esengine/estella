---
section: Fixed
commits:
  - fix(editor): resolve inherited shaders in material sample previews
---
**Material sample previews use the shader and blend mode the material draws with.** The shader views tool follows material instances to their parents and understands UUIDs and document-relative shader references. It also reports missing parents and inheritance cycles before drawing.
