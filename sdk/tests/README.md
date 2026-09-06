# Estella SDK Tests

## Types

vitest strips types and never checks them, and `tsconfig.json` compiles `src/`
only — so a fixture can go stale against the API it tests and stay green. One
did: literal schemas missing a field the handshake had gained, passing because
both sides read `undefined`.

```bash
node tools/check-sdk-test-types.mjs            # check (a gate runs this)
node tools/check-sdk-test-types.mjs --update   # bank debt you paid off
```

It is a ratchet over `tools/baselines/sdk-test-types.json`, not a demand for
zero: no new diagnostics, and fixed ones must be banked so they cannot return.
The networking suites (`net-*`, `replication*`, `websocket`) carry **no** debt
and `--update` refuses to add any.

## The component registry, per test

`setup.ts` clears the per-app user component registry before every test, so one
test's `defineComponent` cannot decide another's. It used to clear it to EMPTY,
and that was wrong in a way nothing reported.

Engine components — animation, timeline, AI, audio, joints, UI text, tilemap —
`defineComponent` at SDK module load into that same registry (see the comment
above `markEngineComponentBaseline` in `src/ecs/component.ts`). A module body
runs once, so a clear took them out with nothing to put them back. The result
was never an error: an animator wrote nothing into its joint and the sampled
pose stayed identity, which is a pose no clip can be told apart from. Two cases
in `airborne.test.ts` failed on exactly that; a golden of "every builtin with
field metadata" was silently missing `Marker`.

The setup now snapshots the registry at the FIRST `beforeEach` and reseeds after
each clear. The timing is forced, and the obvious one-liner does not work: a
setup file's body runs before the file under test is imported, with 25 of the
engine's 65 components registered — `markEngineComponentBaseline()` there loses
the other 40, which is a partial restore that looks like a fix. The first
`beforeEach` is the earliest point at which the file's own imports have run.

`harness-component-registry.test.ts` holds both halves, and names `Animator`
(registered by a module only the test file imports) beside `Marker` (registered
by one the setup file imports) so a setup-load snapshot fails it.

**Widening the assertions, retrying, or pinning execution order would not have
been fixes** — they hide a registry lifetime bug that makes some other suite's
green untrustworthy too.

## Running Tests

```bash
# Install dependencies (if not already installed)
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Run specific test file
npx vitest run tests/AsyncCache.test.ts
```

## Test Coverage

### Core Modules

- **AsyncCache** (67 test cases)
  - Basic caching behavior
  - Pending promise deduplication
  - Error handling and failure eviction
  - Cache invalidation (has, delete, clear)
  - Timeout handling
  - clearAll with abort

- **Component Registry** (15 test cases)
  - defineComponent / defineTag
  - Component lookup (getComponent, getUserComponent)
  - Component defaults retrieval
  - Registry clearing and re-registration

- **Query System** (20 test cases)
  - Query creation and iteration
  - Query caching and invalidation
  - Mut() wrapper for mutable access
  - Multi-component filtering

- **Resource System** (12 test cases)
  - Resource definition
  - Res/ResMut descriptors
  - Various data types (numbers, strings, objects, arrays)

- **World/ECS** (25 test cases)
  - Entity spawn/despawn
  - Component insert/get/remove/has
  - Tag components
  - Structural change tracking
  - Query invalidation

- **System Ordering** (7 test cases)
  - runAfter dependency ordering
  - runBefore dependency ordering
  - Mixed dependencies
  - Circular dependency detection
  - Systems without dependencies
  - Non-existent dependencies

## Test Structure

```
tests/
├── README.md              # This file
├── setup.ts               # Global test setup
├── mocks/
│   └── wasm.ts            # Mock WASM module for testing
├── AsyncCache.test.ts
├── component.test.ts
├── query.test.ts
├── resource.test.ts
└── world.test.ts
```

## Notes

### Known Issues

1. **npm cache permission errors**: If you encounter EACCES errors during `npm install`, you may need to:
   ```bash
   # Fix npm cache ownership
   sudo chown -R $(id -u):$(id -g) "$HOME/.npm"

   # Or use --prefer-offline
   npm install --prefer-offline
   ```

2. **TypeScript lib errors**: Tests require ES2015+ features (Symbol, Map). Ensure `tsconfig.json` has:
   ```json
   {
     "compilerOptions": {
       "lib": ["ES2015", "DOM"]
     }
   }
   ```

### Test Data

- All tests use mock WASM module (`tests/mocks/wasm.ts`)
- Tests are isolated via `beforeEach` hooks
- Component registry is cleared between tests (`tests/setup.ts`)

## Coverage Report

To generate coverage report:

```bash
npm test -- --coverage
```

Coverage reports are generated in `coverage/` directory.
