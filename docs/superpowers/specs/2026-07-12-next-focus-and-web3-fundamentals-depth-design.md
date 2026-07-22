# Next Focus and Web3 Fundamentals Depth Design

## Goal

Honor the learner's imported `nextSession.focusTitle` everywhere Terrain selects the next topic, and make Phase 1 teach Ethereum fundamentals deeply enough to implement and debug the underlying byte-level mechanisms.

## Next-topic selection

`MetricsService.nextUp()` remains the single selection seam used by the dashboard, roadmap highlighting, Telegram digest, and default learn export. It first loads the latest imported non-empty `nextFocusTitle` for the user. If that title resolves case-insensitively to a currently startable planned leaf in the requested/enabled domain, it wins. A missing, archived, active, blocked, category, disabled-domain, or domain-mismatched suggestion is ignored and selection falls back to the existing authored creation order.

This requires no schema or API-shape change. The stored title already exists on `SessionExport`, and all consumers already call `nextUp()`.

## Phase 1 depth

Phase 1 remains fundamentals-first, but “mostly theory” no longer means overview-only. Add five focused implementation leaves:

1. SEC1 public-key serialization and Ethereum address derivation.
2. ECDSA signing, verification, recovery, and signature safety.
3. BIP-39 mnemonic-to-seed and BIP-32/BIP-44 child derivation.
4. RLP and typed transaction serialization/signing payloads.
5. Raw JSON-RPC requests and error handling.

Each leaf has bounded primary sources, a runnable build in `web3-practice`, explicit byte-level pitfalls, a deterministic done-when gate, and concept plus code retrieval cards. Existing hashing/Merkle, transaction, and EVM topics keep their scope but receive executable checks where they currently stop at prose.

The key/address lab must distinguish 256 bits from 64 hex characters, compressed SEC1 (`02/03 || x`) from uncompressed SEC1 (`04 || x || y`), hash raw `x || y` without the `04` prefix, use Ethereum Keccak-256 rather than standardized SHA3-256, reject private scalars outside `1..n-1`, and compare its result with Foundry's `cast` output.

## Content guard

Extend `coverage.json` with a `phase1_implementation_depth` checklist. The existing validator must require every listed phrase to appear in the imported curriculum, preventing later simplification back to CLI-only overview material.

## Verification

- A regression test proves a valid stored focus outranks an older startable topic.
- Tests prove invalid stored focuses fall back safely and domain filtering is preserved.
- Web3 structural/schema/coverage validation passes.
- API tests, API build, web build, lint, and formatting checks pass.

## Non-goals

No cryptographic implementation is added to Terrain itself. The learner writes the labs in the separate `web3-practice` repository. No new npm dependency, database migration, UI control, or manual topic-order field is introduced.
