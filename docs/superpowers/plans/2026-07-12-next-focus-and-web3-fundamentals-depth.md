# Next Focus and Web3 Fundamentals Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefer an imported next-session focus when it remains learnable and upgrade Phase 1 with implementation-level cryptography, serialization, RPC, hashing, and EVM exercises.

**Architecture:** Keep `MetricsService.nextUp()` as the shared selector for every consumer and add one lookup before its existing creation-order fallback. Keep course depth in `content/web3/01a-core-ethereum.json`, enforced by the existing content validator through an explicit coverage checklist.

**Tech Stack:** NestJS 11, Prisma 7, Jest, learning-os v2 JSON, Node 24 validation scripts.

## Global Constraints

- No schema migration, new dependency, new API response field, or UI-specific selection logic.
- Stored focus is advisory: use it only when it is a startable planned leaf in scope.
- Every new Phase 1 leaf needs bounded primary sources, Build, Done when, a concept card, and a code card.
- Do not commit unless the user explicitly confirms a commit.

---

### Task 1: Stored-focus priority

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts`
- Test: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Consumes: `SessionExport.nextFocusTitle` and the IDs returned by `startablePlannedIds()`.
- Produces: unchanged `nextUp(userId, domain?, now?): Promise<NextUp | null>`.

- [ ] Add a failing test where the latest stored focus is the second startable topic and must win over the first-created topic.
- [ ] Run `yarn workspace @terrain/api test --runInBand metrics.service.spec.ts -t "prefers the latest imported next focus"`; expect the older topic before implementation.
- [ ] Query the latest imported non-empty focus, resolve it case-insensitively within the startable ID set and domain scope, then retain the current first-ID fallback.
- [ ] Add tests for an unresolved/blocked focus fallback and explicit domain scoping.
- [ ] Run the full metrics suite; expect all tests to pass.

### Task 2: Phase 1 implementation leaves

**Files:**
- Modify: `content/web3/01a-core-ethereum.json`

**Interfaces:**
- Consumes: learning-os v2 topic, source-plan, and prompt shapes.
- Produces: five new pattern leaves and upgraded builds/cards for existing fundamentals.

- [ ] Add SEC1 serialization/address derivation and ECDSA signing/recovery immediately after the wallet overview.
- [ ] Add mnemonic-to-seed/child derivation after the existing HD-wallet mental model.
- [ ] Add RLP/typed transaction serialization after transaction anatomy.
- [ ] Add raw JSON-RPC after nodes/clients.
- [ ] Upgrade hashing/Merkle and EVM builds to leave deterministic runnable checks.
- [ ] Add concept and code cards whose hints name byte boundaries, invariants, and common failure modes.

### Task 3: Regression guard and documentation alignment

**Files:**
- Modify: `content/web3/coverage.json`
- Modify: `docs/superpowers/specs/2026-07-07-web3-solidity-defi-curriculum-design.md`
- Modify: `docs/superpowers/plans/2026-07-07-web3-curriculum-import.md`

**Interfaces:**
- Consumes: the validator's existing phrase coverage mechanism.
- Produces: `phase1_implementation_depth` checklist and durable authoring requirements.

- [ ] Add checklist phrases for SEC1, Keccak address bytes, ECDSA recovery, mnemonic seed derivation, RLP typed transactions, raw JSON-RPC, Merkle proof code, and EVM execution tracing.
- [ ] Replace “mostly theory” guidance with explicit implementation-depth requirements and pitfalls.
- [ ] Run `node scripts/validate-web3-content.mjs`; expect schema, structural, size, and coverage checks to pass.

### Task 4: Full verification

**Files:** none.

- [ ] Run `yarn workspace @terrain/api test --runInBand`; expect zero failed suites.
- [ ] Run `yarn workspace @terrain/api build`; expect exit 0.
- [ ] Run `yarn workspace @terrain/web build`; expect exit 0.
- [ ] Run `yarn lint`; expect exit 0.
- [ ] Run `yarn format:check`; expect exit 0.
- [ ] Inspect `git diff --check` and `git status --short`; expect no whitespace errors and only intended files changed.
