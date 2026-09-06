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

### `airborne.test.ts` is order-dependent in full-suite runs

Two of its cases (`tilts about X, which every ground clip leaves alone` and
`is far enough from every other shipped pose to be told apart`) **pass on their
own and fail in a full-suite run**:

```bash
npx vitest run sdk/tests/airborne.test.ts   # 10 passed
cd sdk && npx vitest run                    # 2 failed
```

Four facts, so nobody investigates this as a new red:

- Isolated: green. Full suite: red. The two runs disagree about the same code.
- Reproduced on a **worktree at HEAD before the Streaming Delivery work**, and
  again with that work's own test file excluded. It predates those changes.
- **No evidence ties it to residency / prefetch / publication.** Its imports are
  gameplay, animation, timeline and ECS; nothing it reads was touched.
- The fix is to find what leaks state between files and restore isolation.
  **Widening the assertions, retrying, or pinning the execution order are not
  fixes** — they hide the leak, and the leak is what makes some other suite's
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
