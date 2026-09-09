# Verification and Measurement Discipline

> Applies to every criterion, gate, benchmark and one-off measurement. It is a
> thinking obligation, not a tool: nothing here is machine-checked, and it should
> stay that way until the same blind spot has cost us twice.

A criterion that cannot fail and a measurement that cannot mislead are both rare
by accident. Each rule below exists because one of ours did not have the property
and passed anyway.

---

## 1. Discriminability

Before accepting a criterion — or a result — answer four questions:

1. **What observation makes this pass?**
2. **What incorrect world produces the same observation?**
3. **What sabotage or counterfactual separates them?**
4. **Ask the same three of the instrument itself.**

Question 2 is the one that is usually skipped, and it is the one that finds the
gate that examines nothing. Question 4 is new for the same reason: an instrument
is a claim about a system, and a claim nobody interrogated is a claim.

---

## 2. Instrumentation is an intervention until proven otherwise

An observer that changes the system produces a reading about a system that does
not ship. This is not a rule that overhead must be zero — it is a rule that a
reading taken *with* an instrument may not be presented as a reading of the
system *without* it.

Before trusting a performance number, know whether the instrument changed:

- scheduling, or when work happens
- the amount of work, or the workload's shape
- the DOM / render path
- synchronisation, or what waits on what
- cache or JIT state
- the lifecycle of the thing being measured

*Measured here:* a diagnostic gate over the editor overlay's DOM writes was
installed unconditionally and cost 70% of the arm it was supposed to be the
baseline for. The only symptom was that the baseline moved — 116.7ms to 200.1ms —
and that reads exactly like run-to-run noise.

---

## 3. A census needs a denominator

> A census that captures nothing and a census that captures everything are both
> green.

Checking that every captured item is valid says nothing until the corpus is
known to contain the dangerous ones. So a census must also answer:

- **captured what** — a count, and a positive witness that a real instance was seen
- **out of what** — the universe it drew from, ideally an authoritative discovery
  source rather than a hand-written list
- **excluded what, and why** — an exclusion nobody can see is an exclusion nobody
  reviewed

*Measured here:* a census listed the CSS property names an overlay writes, in
order to gate them. It matched none of them — the accessors were not where it
looked — and reported the same clean pass as one that matched all of them, for
three rounds of measurements that were published as results.

---

## 4. A number is not yet an explanation

Ask of a surprising result — including one that supports the hypothesis —
**what bad world produces the same number?**

- `10 fps` is window throttling, *or* an overlay saturating the compositor.
- `60 fps with zero paints` is a scheduler that finally settles, *or* gizmos that
  have silently frozen.
- `0 pixels changed` is nothing to redraw, *or* a check looking at the wrong part
  of the screen.

A red result gets interrogated because it demands work. A green one that agrees
with the hypothesis is the one that gets believed, and is where this rule earns
its keep.

---

## Checklist

Six questions, before writing a gate or a benchmark:

- [ ] What claim am I testing?
- [ ] What observation represents it?
- [ ] What wrong implementation looks identical?
- [ ] What sabotage separates them?
- [ ] Can the observer change the system?
- [ ] Does the census prove what it actually covered?
