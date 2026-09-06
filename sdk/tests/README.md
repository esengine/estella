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

## Known debt

### `airborne.test.ts`: the shared setup clears engine components

Two of its cases (`tilts about X, which every ground clip leaves alone` and
`is far enough from every other shipped pose to be told apart`) fail under this
package's vitest config and pass under the repo root's — **the same single file,
the same code, no other test running**:

```bash
npx vitest run sdk/tests/airborne.test.ts   # from the repo root: 10 passed
cd sdk && npx vitest run tests/airborne.test.ts   # 2 failed
```

So this is **not** order dependence, and not cross-file state leakage. It was
first recorded as "order-dependent in full-suite runs"; that reading came from
comparing a root-config run against a package-config run and reading the
difference as isolation. Bisecting the config difference names the trigger
exactly: with `setupFiles: ['tests/setup.ts']` removed and everything else
identical, the file passes 10/10.

`tests/setup.ts` runs `clearUserComponents()` before every test. Engine
components — animation, timeline, AI, audio, physics joints, UI text, tilemap —
`defineComponent` at SDK module load into the **same per-app user registry** a
project's own components use (see the comment above `markEngineComponentBaseline`
in `src/ecs/component.ts`). Clearing it drops those too, with nothing to put them
back, so the animator writes nothing into the joint and the sampled pose stays
identity — which is a pose no clip can be told apart from.

**The obvious one-line fix does not work.** `seedEngineComponents()` exists for
exactly this, but it is a no-op until `markEngineComponentBaseline()` has run,
and setup files execute *before* the test file's imports — so at setup time the
engine components this file needs are not registered yet and there is nothing to
snapshot. Any fix has to establish the baseline after collection (the first
`beforeEach` is the earliest such point) and reseed after each clear, which
changes the component-registry lifetime for all 509 test files. That deserves its
own change with a full-suite before/after, not a patch here.

**Widening the assertions, retrying, or pinning execution order are not fixes** —
they hide a registry lifetime bug that makes some other suite's green
untrustworthy too.

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
