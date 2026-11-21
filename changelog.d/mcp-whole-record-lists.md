---
section: Fixed
commits:
  - fix(editor): an agent can write a whole list of records a component has no Details row for, such as a Spline's points
---
**An AI agent can set a Spline's points.** A list a component declares but Details has no row of its own for was taken to be a list of project paths, so writing a Spline's points (or any list of records) over MCP, through set_field or a scene op, was refused with "is a list of strings". The list is now checked against what the component's own default holds: records where it holds records.
