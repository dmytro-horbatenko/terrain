# Web3 / Solidity / DeFi Learning Path — Design

## Purpose

Seed Terrain with a comprehensive, code-first learning graph for Web3,
Solidity, DeFi, and smart-contract security — the second domain after DSA.
Unlike the DSA path (chat-and-review over curated LeetCode problems), this
path is **resource-driven and hands-on**: every topic points at the best
external resource (video/reading/reference) and requires the learner to
**write code — contracts, exploits, tests, from-scratch protocols** — before
the topic counts as done. Terrain remains the context store, scheduler, and
progress mirror; the learning happens across Cyfrin Updraft, from-scratch
build tutorials, wargames, and audit contests, with Claude.ai sessions acting
as code reviewer and adversary. Tooling is **dual-chain**: Foundry primary for
testing/security/gas, Hardhat for TS-heavy deployment and full-stack (see
"Tooling baseline").

Learner profile: experienced web developer, **near-zero blockchain
experience**, ~10–15 h/week, no hard deadline. Goal: **deep generalist
mastery** across fundamentals, Solidity, DeFi, and auditor-grade security —
not a single career endpoint. Horizon: realistically 12–18 months; each phase
is independently valuable so the path pays off incrementally.

## Scope

In scope: one root topic (`domain: 'Web3'`), 10 phase chapters, ~300–360 leaf
topics with embedded resources + build tasks + done-when criteria, prerequisite
wiring, SR prompts per durable concept, one capstone milestone project per
phase, and a hybrid Foundry + Hardhat practice monorepo scaffold (separate git
repo) that the topics point into.

Out of scope: any API/schema/UI changes to Terrain (content-only, like DSA);
authoring the practice-repo solution code (the learner writes it — we scaffold
structure only); non-EVM chains (Solana/Rust appear only as an optional
mention); making the initial import exhaustive-forever (the living-roadmap
extension flow is the intended growth path — see "Extensibility").

## Approach (why B)

Three structures were considered:

- **A — Course-mirror:** topics mirror Cyfrin Updraft 1:1. Fast to author and
  coherent, but locks to one provider, defers security to a single late block,
  and under-weights from-scratch builds, theory, and frontend that live outside
  Updraft. Weakest for deep generalist mastery.
- **B — Phased spiral with woven security (chosen):** ~10 sequential phases;
  each interleaves the strongest resource per concept regardless of provider
  (Updraft as spine, plus Jeiwan/RareSkills for builds, Mastering Ethereum /
  noxx for theory, Speedrun for frontend). Security threads through from Phase 4
  and deepens into a full auditor phase. Each phase ends in a milestone project.
- **C — Project-milestone driven:** projects are the spine, concepts hang off
  them. Maximally hands-on but uneven theory/security coverage; better suited to
  an employability-first goal, which was not chosen.

B is chosen: it serves deep generalist mastery, is provider-agnostic (best
resource per topic), makes security a habit rather than a bolt-on, absorbs C's
milestone projects, and absorbs A's Updraft-backbone coherence without being
trapped by one provider.

## Tooling baseline (2026)

**Dual-chain: Foundry-primary + Hardhat for the TS-heavy layer.** Both are
widely used in 2026; Foundry dominates security/auditing and new-protocol work,
while Hardhat remains very common in frontend-coupled / TS-heavy shops. Hardhat
3 (Rust "EDR" execution layer) closed the speed gap and can read `foundry.toml`,
share artifacts, and run mixed Solidity+TS suites — so the two coexist in one
repo. This split matches the learner's preference (learn Foundry deeply,
including its module/dependency/remappings model, but use Hardhat for advanced
deployment/scripting/full-stack) and a mainstream production pattern.

- **Foundry (primary)** — forge/cast/anvil/chisel — owns unit/fork/**fuzz/
  invariant** testing, all **security** work, and all **gas** work. This is not
  negotiable for the security/gas strands: Ethernaut, Damn Vulnerable DeFi v4,
  DeFiHackLabs replays, gas-puzzles, and the Cyfrin/Jeiwan/RareSkills
  from-scratch builds are authored in Foundry. Also the toolchain the learner
  most wants to go deep on (dependency management, remappings, submodules,
  profiles).
- **Hardhat 3 (secondary)** — owns **TS deployment pipelines**, scripting,
  network/config management, and the **full-stack** projects (couples cleanly
  to a viem/wagmi frontend). Introduced as its own tooling chapter and used for
  deployment-heavy + Phase 10 milestones.
- **Interop** — the practice repo is a hybrid: Foundry for `test/`, Hardhat 3
  for `deploy/` + `script/`, sharing one contracts tree via `foundry.toml`
  readback. A dedicated topic covers standing up this hybrid.
- **Cyfrin Updraft** is the free spine (beginner → security → assembly/formal
  verification as one coherent path; ethereum.org endorses it). It is
  Foundry-taught; Hardhat is layered in from complementary resources (Hardhat 3
  docs, its Ignition deployment system) rather than replacing Updraft.
- Confirmed-stale resources deliberately excluded: CryptoZombies, Patrick
  Collins' old YouTube courses (deprecated → Updraft), Questbook, Capture the
  Ether (Ropsten-dead; use the RareSkills Foundry port), Paradigm CTF (on
  hiatus). "How to DeFi" books treated as skippable.
- Currency deltas baked in: Mastering Ethereum **2nd ed. (Nov 2025)** replaces
  the stale 1st ed.; MakerDAO → **Sky / DAI → USDS**; **Pectra (EIP-7702) +
  Fusaka (PeerDAS)**; Uniswap **V4 hooks**; ERC-7683 intents; SWC registry
  deprecated → **EEA EthTrust SL v3** + **OWASP SC Top 10 (2026)**; Damn
  Vulnerable DeFi **v4.1.0**.

## Data model mapping

Reuses `Topic` and `Prerequisite` exactly as the DSA path did — no new schema.

- **Root** — `title: "Web3 / Solidity / DeFi"`, `domain: 'Web3'`,
  `topicType: 'concept'`, `parentId: null`. Description holds path rationale +
  source attribution.
- **Phase chapter** (10 rows) — `parentId` → root, `topicType: 'concept'`.
- **Sub-chapter** (where a phase is large, e.g. attack families) —
  `topicType: 'concept'`, `parentId` → phase.
- **Leaf topic** (~300–360) — `topicType: 'pattern'` (reuses the existing type;
  or a new `'skill'` type if we decide the label matters — decided below: reuse
  `'pattern'` to avoid a seed change). **This is the reviewable SR unit** —
  SM-2/FSRS fields exercised here. `description` holds the five-part content
  model (below).
- **Prerequisite DAG** — phase-level edges are linear (Phase N requires N-1)
  except Phases 8–10, which only require Phase 7 and are mutually orderable.
  Leaf edges default to an in-chapter chain plus explicit cross-chapter edges
  where a real dependency exists (e.g. every "build a proxy" topic requires the
  `delegatecall` + storage-layout topics from Phase 2; oracle-manipulation
  attacks require the oracle topics from Phase 7 — so the security phase
  references DeFi primitives it attacks).

`domain: 'Web3'` keeps the path filterable and visually separate from DSA on
the roadmap.

## Topic content model (code-first)

Every leaf topic's `description` follows a fixed five-part shape:

```
CONCEPT   — 2–4 sentences: definition + why it matters / when it bites.
RESOURCES — the single best source per concept, with a specific anchor
            (▶ video lesson, 📖 chapter/section, 🔗 reference page) —
            never a bare "watch Updraft".
BUILD     — the hands-on task, naming the exact practice-repo path it writes
            into (e.g. "contracts/phase02/Delegatecall.sol + test").
            For attacks: write the exploit that breaks it, then the fix.
DONE-WHEN — explicit exit criteria: tests pass / gas under target / exploit
            reproduced then reverts / invariant holds. Never "understood it".
PROMPTS   — carried in proposedPrompts[]: SR retrieval cards for the durable
            idea so it survives months of spacing.
```

**Code-first is mandatory.** Any topic with a code surface (the large majority)
has a BUILD that writes/tests contracts. Only pure-theory topics (most of Phase
1, some frontier concepts) may substitute "write an explainer / annotate a
diagram" for code. Target mix across the path: ~70% hands-on / 30% consuming.

**AI-session role (reuses the existing session loop):** after the BUILD, a
Terrain session does teach-back + code review — the learner points at their
contract, Claude probes edge cases, names the attack they missed, and the
mastery/application gate flips only when the code holds up. AI is reviewer and
adversary, not lecturer.

## Curriculum — 10 phases

Each phase = a chapter; each ends in a milestone project (Section "Milestones").

**Phase 1 — Blockchain & Ethereum fundamentals (~30 topics).**
Blockchain basics · accounts/tx/gas · EVM execution model · consensus (PoS) ·
L2s/rollups (L2Beat trust framework) · account abstraction (ERC-4337 + EIP-7702)
· 2025–26 protocol state (Pectra/Fusaka). Resources: Updraft *Blockchain
Basics*, ethereum.org concepts, Mastering Ethereum 2e (selected ch.), noxx EVM
deep-dives 1–3 + evm.codes. Mostly theory; BUILD = wallet/tx from CLI + written
explainers.

**Phase 2 — Solidity language, exhaustive (~45 topics).**
Types/data locations · functions/visibility/modifiers · storage layout ·
inheritance/shadowing/super · events (+ advanced) · custom errors ·
payable/sending ETH/fallback/receive · `call`/`delegatecall`/`staticcall` ·
ABI encode/decode · hashing · signatures (ECDSA/EIP-712) · libraries ·
interfaces · assembly/Yul intro · transient storage · user-defined value types
· every solidity-by-example "basics" page. Resources: Updraft *Solidity Smart
Contract Development* + SBE basics as reference. BUILD: re-implement each
construct with tests.

**Phase 3 — Tooling: Foundry & Hardhat, exhaustive (~30 topics).**
*Foundry core (primary):* forge/cast/anvil/chisel · unit/fork/fuzz/invariant
testing · cheatcodes · scripting/deployment/verification · gas snapshots ·
coverage · **dependency/module system** (git submodules, remappings, soldeer,
profiles) · Slither/Aderyn wiring. Resources: Updraft *Foundry Fundamentals*.
*Hardhat 3 sub-chapter (secondary):* project setup · TS testing · **Ignition
deployment** · network/config management · plugins · **Foundry interop**
(reading `foundry.toml`, shared artifacts, mixed test suites) · when to reach
for which. Resources: Hardhat 3 docs. BUILD: stand up the hybrid practice repo
(Foundry `test/`, Hardhat `deploy/`). Speedrun Ethereum challenges 0–2 in
parallel for the viem/wagmi frontend layer.

**Phase 4 — Core contract patterns & standards (~40 topics).**
ERC-20/721/1155/4626 · proxies & upgradeability (Transparent/UUPS/Diamond) ·
access-control patterns · pausing/reentrancy guards · signatures/permit/meta-tx
· merkle airdrops · multisig · factories/CREATE2/minimal-proxy clones ·
DAOs/governance. Resources: Updraft *Advanced Foundry*, OZ contracts, SBE app
examples. **Security thread starts here:** each standard carries a "threat
model" note linking its attack (ERC-20 → fee-on-transfer/approval-race; proxy →
storage-collision/uninitialized-impl).

**Phase 5 — Gas optimization, exhaustive (~30 topics).**
Six families (storage · calldata/memory · control flow · types/layout ·
assembly/Yul · architecture) covering the full RareSkills 80+ tips.
Resources: RareSkills gas-optimization book + gas-puzzles repo, Node Guardians
gas-golf quests. BUILD: beat the gas target on each puzzle — passing condition
is literal. (Detailed catalog in "Gas catalog" below.)

**Phase 6 — Security & auditing, exhaustive attacks (~70 topics).**
Full attack taxonomy (see "Attack taxonomy" below) · audit methodology ·
static analysis (Slither/Aderyn) · fuzzing/invariants for security · report
writing · Ethernaut (all 41) · Damn Vulnerable DeFi v4 (all 18) · DeFiHackLabs
real-exploit replays · CodeHawks First Flights. Resources: Updraft *Smart
Contract Security* (24h), Trail of Bits building-secure-contracts, solidity-by-
example hacks, DeFiVulnLabs, OWASP SC Top 10 (2026), Solodit checklist.

**Phase 7 — DeFi mechanics & from-scratch builds (~50 topics).**
AMMs (constant-product/constant-sum/stableswap) · Uniswap V2 → V3 → V4/hooks ·
lending (Aave V3 / Compound V3) · stablecoins (CDP, overcollateralized
algorithmic, Sky/USDS delta) · oracles (Chainlink/TWAP/Pyth) · staking/LSTs/
restaking (Lido/EigenLayer) · perps (GMX/Hyperliquid) · yield/vaults (ERC-4626)
· flash loans. Resources: Jeiwan Programming-DeFi (V2 clone) + Uniswap V3 book,
RareSkills V2 book, Cyfrin *DeFi Stablecoin* + advanced-DeFi protocol courses
(V2/V3/V4/Curve/Aave/GMX), Finematics for concept intros. **Build from
scratch**, not just read.

**Phase 8 — EVM internals & advanced Solidity (~30 topics).**
Opcodes deep · Yul/Huff · storage/memory/calldata at bytecode level · function
selectors/dispatch · proxies at bytecode level · formal verification
(Halmos/Certora/Kontrol) · optional EVM-from-scratch challenge. Resources:
Updraft *Assembly & Formal Verification*, noxx (full), evm.codes,
w1nt3r EVM-from-scratch, RareSkills.

**Phase 9 — Frontier strands (~30 topics).**
MEV (Flashbots/PBS/searching/sandwich/arb) · intents/ERC-7683 · Uniswap V4
hooks deep (Atrium hook incubator) · restaking/EigenLayer · RWAs · ZK
(RareSkills ZK book / Noir) · L2 internals (Arbitrum Nitro / OP Stack).
Independently orderable after Phase 7.

**Phase 10 — Full-stack dApp (~20 topics).**
viem/wagmi · wallet connection · reading/writing contracts · events/indexing ·
Scaffold-ETH 2 · the Speedrun Ethereum challenge ladder (finish it). BUILD:
ship a real UI for one of the learner's own protocols.

**Ongoing standing loop (not a phase):** audit-contest participation (CodeHawks
→ Code4rena/Sherlock/Cantina), rekt.news + BlockThreat incident reading, and
DeFiHackLabs replays continue in parallel once Phase 6 is underway.

## Attack taxonomy (Phase 6 leaf topics)

Eight families, ~50 attack leaf topics; each pairs to a wargame level and/or a
real DeFiHackLabs replay, with BUILD = write the exploit then the fix.

1. **Reentrancy** — single-function · cross-function · cross-contract ·
   read-only · ERC-777/callback-hook. (DAO, Cream; DVD Side-Entrance/Rewarder;
   Ethernaut L10.)
2. **Access control & authorization** — missing/incorrect modifiers ·
   `tx.origin` auth · uninitialized proxy/owner · unprotected initializer ·
   unprotected `selfdestruct` · default-public · privilege escalation ·
   signature-auth gaps. (Parity; Ethernaut Telephone/Motorbike.)
3. **Arithmetic & precision** — overflow/underflow (pre-0.8 + `unchecked` +
   casts + asm) · division-before-multiplication · rounding direction ·
   precision loss · ERC-4626 first-depositor/inflation · donation · decimals
   mismatch. (BEC; vault-inflation findings.)
4. **Price/oracle & flash-loan-enabled** — spot manipulation · TWAP
   manipulation · flash-loan price manipulation · flash-loan governance ·
   stale/wrong oracle · decimals/heartbeat · read-only reentrancy into oracles.
   (Mango, Harvest, Beanstalk, bZx; DVD Puppet/V2/V3/Curvy-Puppet.)
5. **External-call & token-integration** — unchecked returns · fee-on-transfer
   · missing-return (USDT) · approve race · rebasing tokens · callback tokens ·
   force-feeding ETH · gas-griefing · return-bomb. (SafeERC20 class; SBE hacks.)
6. **Signatures & cryptography** — replay (missing nonce) · cross-chain replay
   (missing chainId) · malleability · missing EIP-712 domain separator ·
   zero-address ecrecover · permit front-running · merkle forgery/second-
   preimage. (DeFiVulnLabs SignatureReplay.)
7. **Ordering, timing & MEV** — front-running · sandwiching · back-running ·
   missing slippage/deadline · commit-reveal absence · weak/on-chain randomness
   · timestamp dependence · JIT liquidity. (Ethernaut Dex/CoinFlip; Fomo3D.)
8. **Proxy/upgrade, storage & DoS** — storage-slot collision · selector clash ·
   uninitialized implementation · delegatecall-to-untrusted · storage
   corruption via delegatecall · unbounded-loop/gas-limit DoS · push-vs-pull ·
   block-stuffing · revert-griefing. (Parity; Ethernaut Preservation/
   Puzzle-Wallet.)

Plus a **business-logic & misc chapter** — accounting/invariant violations,
state-machine errors, insufficient input validation, contract-size checks,
create2 address reuse, honeypots, tx.origin phishing — trained via DeFiHackLabs
replays and First Flights (business logic is OWASP-2026 #1 and can only be
trained, not enumerated).

**Coverage guarantee:** this set is the union of OWASP SC Top 10 (2026), the
24-class auditor canon, all 41 Ethernaut levels, all 18 Damn Vulnerable DeFi
v4 challenges, the solidity-by-example hacks section, and DeFiVulnLabs' 48
patterns — cross-referenced so nothing in those sources lacks a home topic.
Anchored to the Solodit ~380-check checklist as the working reference.

## Gas catalog (Phase 5 leaf topics)

Six families, ~28 topics, each with a gas-puzzle BUILD proving the saving:

- **Storage** — slot packing · warm/cold (EIP-2929) · minimize SLOAD/SSTORE ·
  cache storage in memory · `constant`/`immutable` · refunds · transient
  storage (EIP-1153) · struct/enum packing.
- **Calldata & memory** — `calldata` over `memory` · custom errors over require
  strings · shrink calldata · avoid memory expansion · `abi.encodePacked` cost.
- **Control flow** — short-circuit ordering · unchecked increments · `++i` vs
  `i++` · cache array length · avoid redundant checks · early return.
- **Types & layout** — word-size choices · bytes32 over string · bitmaps/
  bitpacking flags · mappings vs arrays.
- **Assembly/Yul** — cheap hashing · direct storage slots · low-level calls ·
  masking · selector optimization.
- **Architecture** — minimal-proxy clones · singletons · batching/multicall ·
  pull-over-push · off-chain compute + on-chain verify.

Backed by the RareSkills gas book (80+ tips) + gas-puzzles repo + Node
Guardians gas-golf.

## Milestones (one capstone per phase)

Each is a real artifact in the practice repo:

1. Wallet/tx from CLI + a written "how Ethereum works" explainer.
2. Canonical contracts re-implemented unaided, with tests.
3. Fully-tested (Foundry) multi-contract project, **deployed via Hardhat
   Ignition** (VRF lottery or similar) — exercises the hybrid toolchain.
4. Token + upgradeable-proxy + governance suite.
5. Gas-puzzle set beaten to target.
6. A submitted CodeHawks First Flight finding with a working PoC.
7. From-scratch AMM + overcollateralized stablecoin + lending protocol.
8. Assembly-optimized contract + one formal-verification proof.
9. Two of {Uniswap V4 hook, MEV searcher bot, ZK circuit}.
10. A full dApp frontend for one of the learner's own protocols.

## Practice monorepo

A separate git repo (not Terrain), scaffolded as part of implementation — a
**hybrid Foundry + Hardhat 3** repo (Hardhat reads `foundry.toml`):

```
web3-practice/
  foundry.toml              # source of truth for sources/remappings
  hardhat.config.ts         # Hardhat 3, reads foundry.toml; Ignition deploy
  package.json              # hardhat, viem/wagmi (for full-stack)
  README.md                 # index: phase -> topics -> paths
  contracts/
    phase01-fundamentals/ ... phase10-fullstack/
  test/                     # Foundry tests (forge) — primary
  deploy/                   # Hardhat Ignition modules + TS deploy scripts
  security/                 # ethernaut/, damn-vulnerable-defi/, replays/ (Foundry)
  defi/                     # from-scratch builds (amm, stablecoin, lending)
  gas/                      # gas puzzles (Foundry)
  frontend/                 # Phase 10 dApp (viem/wagmi)
```

Foundry owns `test/`, `security/`, `gas/`; Hardhat owns `deploy/` + scripting;
`defi/` builds follow their source tutorial's chain (mostly Foundry). Every
Terrain topic's BUILD names the exact path it writes into, so the topic↔code
mapping is explicit and greppable. We scaffold structure + both configs +
README index only; the learner writes the solution code.

## Delivery mechanism

Content-only, mirroring the DSA import exactly — **no API/schema/UI changes**.

1. Author **one markdown file per phase** (10 files) under `content/web3/`,
   each a fenced ` ```learning-os ` block validated by `learningOsSchema` /
   `import.service.ts`, containing that phase's `proposedTopics[]` (wired via
   `parentTitle` + `prerequisiteTitles[]`) and `proposedPrompts[]`. The root +
   phase-chapter rows live in the first file (or a dedicated `00-root.md`).
2. Import each via `POST /sessions/import/preview` (dry run) → fix reported
   issues (cycles, ambiguous/missing title refs, collisions) → re-preview →
   `POST /sessions/import` for real (all-or-nothing transaction).
3. Cross-file references (a later phase's prereq pointing at an earlier phase's
   topic) require import order: root/Phase 1 first, ascending. Confirmed
   supported by the existing title-resolution logic; verified at preview time.

Reuses the existing `concept`/`pattern` `TopicType` rows — no new type
registration. No conflict with the DSA seed (different `domain`).

## Extensibility

The initial import is a strong starting graph, not the final word. Terrain's
living-roadmap **roadmap-extension prompting** is the intended growth path: as
new attack classes are disclosed, protocols ship, or the learner wants more
depth, an AI session proposes new sub-topics and grafts them into the graph via
the same import machinery. The design explicitly does not attempt to enumerate
every future topic — it guarantees coverage of today's canonical sources and
leaves a clean seam for growth.

## Verification

- Reload `/roadmap` filtered to `domain: 'Web3'` — confirm a single-root,
  10-branch DAG, no orphans or cycles.
- Spot-check cross-phase prerequisite edges via Prisma (e.g. an oracle-
  manipulation attack really requires the Phase 7 oracle topic; a proxy build
  really requires the Phase 2 `delegatecall` topic).
- Confirm every Ethernaut level, DVD v4 challenge, and OWASP SC Top 10 entry
  maps to at least one leaf topic (coverage-guarantee checklist).
- Confirm the practice-repo skeleton builds on both chains (`forge build` and
  `npx hardhat build` on the empty scaffold, Hardhat reading `foundry.toml`) and
  its README index matches the imported phase/topic names.
- Spot-check that a sample of leaf topics have all five content-model parts,
  with a code BUILD and explicit DONE-WHEN.
