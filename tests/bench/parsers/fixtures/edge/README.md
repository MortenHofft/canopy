# Edge-case fixtures

Hand-crafted Newick/NEXUS inputs, both well-formed and malformed, used by `src/correctness.mjs` to
check how each parser handles the corners. Each entry carries its own expectation: `wellFormed` says
whether the input should parse at all and, when it should, `tipCount` and `tipLabels` give the expected
tip count and tip labels. A `null` expected value means we don't assert that field.

A parser can land on one of:
- `ok` — parsed and matches the expectation,
- `wrong` — parsed but with the wrong tip count / labels / length flag,
- `error` — threw an Error (clean refusal),
- `crash` — threw a non-Error, hung the stack, or produced `undefined`/`null`.

For malformed input we accept `error` as a valid outcome; `ok`/`wrong`/`crash` are the ones worth
flagging.
