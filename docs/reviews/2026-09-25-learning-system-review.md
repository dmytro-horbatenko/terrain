# Terrain and the learning system — comprehensive review

Reviewed 25 September 2026. This is an assessment and a proposed direction, not an implementation plan or a claim that the recommendations have been applied.

## 1. What I understand you want

I could read your original Russian message in the [shared conversation](https://chatgpt.com/share/6ab63072-291c-83ed-a093-56a9aa8c37c1), including the short follow-up. I treated your words as the primary statement of intent. The assistant's expanded prompt in that conversation is useful context, but its additional subjects and requirements are not automatically yours.

You want to become a much stronger, versatile engineer with particular depth in Web3, Solidity and DeFi. You want architectural judgment, system design and algorithmic problem solving, and eventually the ability to compete for demanding engineering roles. You want to understand mechanisms, retain what you learn, and return to organized notes. You are asking whether the courses, projects, app and daily routine actually produce that result, and what should change.

Your saved Terrain profile adds important constraints: roughly four years of programming, including two in Web3; TypeScript experience; about two to three hours available almost daily; a preference for Socratic, step-by-step, depth-first learning; and an explicit preference against turning the roadmap into a shortcut to immediate job readiness. You already have a job. You use OneNote on iPad for drawings and Obsidian for Markdown.

I therefore would not replace your path with a short interview sprint or skip foundational topics merely because you have work experience. I would preserve the full long-term curriculum while making its sequence, evidence and workload more coherent.

“10x” is an aspiration, not a useful completion criterion. A practical translation is: you can explain the mechanism, implement it, diagnose failures, compare alternatives and adapt it to a changed problem later, with the amount of assistance recorded honestly. No course count or app score can guarantee that outcome or a particular job.

## 2. Overall judgment

Terrain already contains most of the machinery this learning system needs. The project briefs are substantial, the Web3 content is unusually concrete, and the session workflow already includes teach-back, application and delayed independent checks. The highest-value work is to make these parts agree with each other.

The main weaknesses are:

1. Broad chapter prerequisites enforce an unnecessarily rigid sequence and delay material needed by the early projects.
2. The tutor's knowledge context can overstate reliability after failed recalls and omit the lesson evidence inside prerequisite chapters.
3. The app stores session summaries more effectively than it supports a durable, navigable body of personal knowledge.
4. Recall, application, project completion and independent transfer are represented, but their meanings are not consistently reflected in the tutor context and progress labels.
5. The combined catalogue is large enough to become a planning and maintenance burden unless the active workload stays small.

I recommend improving the existing system, then using it consistently. I do not recommend replacing FSRS, rewriting the app, adding a vector database, building another notes editor or importing several more complete curricula immediately.

## 3. What was inspected, and what the evidence means

The review covered the shared conversation, the local Terrain code and content, the signed-in deployed app, the project catalogue, selected primary references, and the separate `web3-practice` repository. All curriculum files were inventoried and structurally checked; examples were read closely. This was not an independent factual audit of every prompt and external source, a production penetration test, or a review of all your professional work.

| Area | Observed scope |
|---|---|
| Web3 curriculum | 24 import files; 462 entries: 97 organizational groups and 365 learning topics; 526 prompts |
| Web3 prompt mix | 369 concept, 91 code, 66 problem prompts |
| Web3 source plans | Every learning topic has a source plan and a Build / Done-when task; 597 required source options, covering 393 distinct URLs |
| DSA curriculum | 18 import files; 100 entries: 19 groups and 81 learning topics; 308 prompts |
| DSA prompt mix | 81 concept, 66 code, 161 problem prompts |
| Product projects | 12 projects, 76 milestones, an estimated 433–692 building hours before separate study and maintenance |
| Live Web3 state | 15 active entries, 447 planned, none marked mastered; 365 learning topics |
| Live review state | Today's bounded slice: 3 cards, approximately 15 minutes. Full eligible backlog: 43 cards, approximately 295 minutes; 34 awaiting first review |
| Live recent evidence | 6 self-rated reviews in seven days; one delayed skill check due 11 September with no attempt recorded |

These numbers describe the recorded system, not your total competence. Six reviews do not measure all the engineering or studying you did. Zero mastered topics does not mean zero useful knowledge. The visible first eight project cards were unstarted; I did not infer that no project work exists elsewhere.

The nonce/replay-protection topic provides a useful counterexample to a superficial “you only collect content” diagnosis. It contains source reconstruction, substantive reasoning, an application record and a review note. Its delayed check is still pending. The issue is carrying good individual sessions into a dependable continuing routine.

I could see the saved note reference and summary, but did not inspect the actual Obsidian vault or OneNote notebooks. Conclusions about those tools concern their connection to Terrain, not the quality of all your notes.

## 4. App review: keep the foundations, fix the meaning of the evidence

### 4.1 Two confirmed defects in the tutor context

**Priority 1: failed recalls still qualify a topic for “may rely on.”**

In [learning-context.service.ts](/Users/dmitrijgorbatenko/personal/consistency/apps/api/src/learning/learning-context.service.ts:565), any recent review history makes an active topic `practicing`; that category is included in `mayRelyOn`. The grade values are not consulted by this classification. A focused reproduction with three `again` grades returned `practicing`. A topic already marked `mastered` returned `mastered` despite a failed recall, because the stored status takes precedence.

The evidence is available elsewhere in the response, so a careful tutor might correct for it. However, the explicit instruction says it may rely on this knowledge. That invites the tutor to skip a needed check or build an explanation on a weak prerequisite.

The smallest useful correction is to distinguish evidence of prior study from evidence that a concept is currently safe to assume. Recent failures and relevant unsuccessful independent checks should cause the tutor to verify the concept. One difficult recall should not permanently erase prior progress. Acceptance criterion: several recent failed recalls cannot yield an unconditional “may rely on,” including when the historical status is mastered.

**Priority 1: prerequisite chapters lose their contained lesson evidence.**

The traversal in [learning-context.service.ts](/Users/dmitrijgorbatenko/personal/consistency/apps/api/src/learning/learning-context.service.ts:548) follows prerequisite edges. It does not expand the lessons contained within a prerequisite group. The `children` field later follows prerequisite edges again, rather than the group's topic hierarchy.

For `EOAs vs contract accounts`, the prerequisite traversal included the cryptography and blockchain groups but not their contained learned lessons. Meanwhile, roadmap eligibility correctly evaluates the descendants. A chapter can therefore be satisfied for navigation while its context has little evidence and its planned container status is classified as unseen.

This can produce repeated teaching of completed material, missing context about real weaknesses, and conflicting instructions in the same export. Use a compact summary of the relevant descendant evidence. Acceptance criterion: a completed prerequisite chapter conveys its constituent learning evidence, and an organizational container is not described as an unstudied lesson simply because its own status remains planned.

### 4.2 “Mastery” is currently a progress rule

The rule in [metrics.service.ts](/Users/dmitrijgorbatenko/personal/consistency/apps/api/src/metrics/metrics.service.ts:65) checks that every non-suspended card has stability of at least 30 days, that an application event exists, and that a summary or note reference exists. The import path repeats that logic. A note reference counts toward the “teaching” gate even without an observed explanation. Normal review updates change the scheduler state but do not automatically reverse a previously mastered status.

This is a reasonable progress convention. It is insufficient evidence of broad, independent competence. A familiar card, a single application and a saved note do not demonstrate that someone can solve a new problem after a delay.

The app already has the right complementary feature: delayed skill checks, a preserved first attempt, explicit allowed tools, and assistance-aware independent results. Reuse that evidence. Show distinctions such as “studied,” “recall evidence,” “applied,” and “last independent check,” including dates and limitations. Do not build an opaque replacement score or automatically promote an entire topic because a project checkpoint was saved.

The existing project flow deliberately avoids awarding topic mastery or review grades from a project JSON block. Preserve that boundary. A small improvement would let the learner explicitly link verified project evidence to a related topic without pretending the link itself proves mastery.

### 4.3 Notes are a second-class destination

Your current topic drawer places editing and management ahead of the knowledge summary. Notes appear much further down, and the summary is rendered as plain text, including literal Markdown markers. Search in [Topics/index.tsx](/Users/dmitrijgorbatenko/personal/consistency/apps/web/src/screens/Topics/index.tsx:43) searches titles only.

On the inspected topic, the Obsidian reference was present but the saved vault setting was blank. [The existing link helper](/Users/dmitrijgorbatenko/personal/consistency/apps/web/src/lib/format.ts:61) already supports opening Obsidian when the vault is configured. Start by using that feature.

The topic summary is replaced by each imported composed summary in [import.service.ts](/Users/dmitrijgorbatenko/personal/consistency/apps/api/src/import/import.service.ts:638). Stored session data retains history, but this is not a convenient, versioned personal textbook. Treat the Terrain summary as a compact handoff: what you understand, current weakness, useful artifact and next step. Keep the full canonical note in Obsidian.

Minimal app improvements: put the readable summary and “open note” action near the top; keep management secondary; include summaries in ordinary search; expose the related practice artifact. Do this before adding a new editor or semantic search system.

### 4.4 The daily queue is already bounded; protect that design

The dashboard offers a roughly 15-minute slice even though the full backlog is much larger. It also allows continuing study. The app does not force you to finish the entire backlog before learning.

Keep this. Do not spend an evening clearing 295 minutes of reviews merely to reach zero. Grade honestly, use a bounded review block, and adjust the workload if cards keep accumulating. If necessary, slow new card activation temporarily while continuing meaningful study and projects.

Some scheduled problem prompts are whole 120–240-minute exercises. Twelve such large prompts appeared in the Web3 content. The queue can defer large exercises, but their existence within the same card model still blurs short retrieval and substantial practice. Split the activity conceptually: a short question about the mechanism belongs in recall; the full build belongs in a project or practice session, with a later changed-case check. The existing project and skill-check features cover this need.

### 4.5 Streak and calendar labels need clearer semantics

[streak.service.ts](/Users/dmitrijgorbatenko/personal/consistency/apps/api/src/streak/streak.service.ts:72) counts reviews to identify an active day. It does not count project work or source study. Days with no due work can extend the streak without study. This is a review-habit indicator, not a record of all learning.

Either label it accordingly or count explicitly selected meaningful learning events. Do not encourage a token review merely to make a substantial project day look productive.

Calendar handling is also inconsistent. Streak and some metrics use server-local day boundaries; other scheduling features use the user's setting; browser labels can use browser-local time. The live setting was UTC while this workspace's timezone is Europe/Sofia. Use one explicit learner timezone throughout, and configure the intended study timezone. This matters near midnight; it is not evidence that all historical dates are wrong.

### 4.6 Reliability and engineering structure

The modular Nest application, shared contracts, relational storage and React client are suitable for this workload. Project checkpoints already use revisions and transaction protection. Learning imports, source evidence and practice records have meaningful contracts. Bootstrap includes input validation, restricted CORS, helmet, throttling and secret checks. These are good foundations, not proof of a complete security audit.

Two read-only calls through the installed Terrain connector returned internal error `-32603`, while the signed-in browser worked. The cause was not established. This is an operational problem for seamless tutoring and deserves a separate reproduction with server-side diagnostics. Copy/export is an available fallback. Do not assume these failures have the same cause as the local test environment's socket restrictions.

The web production bundle is about 1.22 MB before compression, about 360 KB gzipped. Screen-level loading could help if startup performance becomes a measured problem. It is lower priority than reliable learning context.

The contributor guide still describes SM-2 and older test totals, whereas the implementation now uses FSRS. Updating this small piece of documentation will reduce future agent mistakes.

## 5. Web3 curriculum: strong material, overly broad gates

### What deserves to stay

The curriculum includes mechanisms, explicit builds, completion conditions and primary-source plans. It goes well beyond memorizing Solidity syntax. Security, signatures, accounting, EVM behavior, protocol mechanics and operational failures all have a place.

Sampled content also handles modern caveats: delegated EOAs under EIP-7702, post-EIP-6780 limitations on older metamorphic-contract ideas, and the need to benchmark gas folklore under the actual compiler. The Yellow Paper source is explicitly scoped to Shanghai. I did not find grounds to call the whole curriculum stale or replace it wholesale.

### The sequence conflicts with the intended parallel study/project model

[00-root.json](/Users/dmitrijgorbatenko/personal/consistency/content/web3/00-root.json) makes whole phases prerequisites. [The roadmap policy](/Users/dmitrijgorbatenko/personal/consistency/apps/api/src/learning/roadmap-policy.ts:70) inherits those constraints and requires all descendant lessons of a prerequisite group to have learned status, meaning active or mastered.

| Phase | Learning topics | Main prerequisite |
|---|---:|---|
| 1. Fundamentals | 35 | None at the phase level |
| 2. Solidity | 43 | Entire Phase 1 |
| 3. Tooling | 29 | Entire Phase 2 |
| 4. Patterns and standards | 33 | Entire Phase 3 |
| 5. Gas | 33 | Entire Phase 4 |
| 6. Security | 80 | Entire Phase 4 |
| 7. DeFi | 37 | Entire Phase 6 |
| 8. EVM internals | 29 | Entire Phase 7 |
| 9. Frontier | 28 | Entire Phase 7 |
| 10. Full-stack | 18 | Entire Phase 7 |

Under ordinary progression, the full-stack phase sits behind 257 preceding learning topics. This is a policy gate based on active/mastered status, not a demand for independent mastery of all 257. Projects themselves remain accessible separately. Nevertheless, linked topic learning can be blocked precisely when an early product needs it.

Specific mismatches:

- Foundry is needed for earlier labs, but the complete tooling phase appears after Solidity. A small initial tool bootstrap and later deep tooling study solve this.
- Phase 1 contains advanced implementation exercises alongside elementary foundations. Keep their depth, but do not make every advanced exercise a universal prerequisite for beginning Solidity or a read-only application.
- All 80 security topics precede DeFi. Some advanced attacks and wargames make more sense after understanding the economic system being attacked.
- Public-chain reads, viem and wallet lifecycle appear late despite being useful in the first product.
- Some frontier strands inherit unrelated broad requirements, such as ZK/RWA following the whole MEV group.

A focused policy reproduction showed an unfinished security exercise blocking the AMM topic, and the still-unlearned DeFi phase blocking viem in the normal progression state. This is the intended implementation of the current data, but the data encodes a poor universal learning order.

### Proposed progression

Keep the full catalogue. Replace broad gates with the concepts an activity actually needs. Ordering can still express your preferred depth-first journey without pretending every earlier chapter is a necessary dependency.

| Stage | Study focus | Practice alongside it |
|---|---|---|
| 1. Ethereum operating model | Accounts, signatures, transactions, nonce, fees, RPC and execution basics; a minimal local tool setup | Existing focused labs; read-only wallet milestone when its readiness conditions hold |
| 2. Contract construction | Solidity semantics, storage, calls, ABI, errors/events; Foundry testing; basic authorization and reentrancy reasoning | Small contracts with explicit invariants, then escrow |
| 3. Application and protocol building blocks | Tokens, signatures, standards, indexing, state machines, databases and recovery | Wallet, indexer, escrow; then selected distribution work |
| 4. DeFi models | Units, fixed-point arithmetic, reserves, shares, collateral, solvency, liquidity and oracle assumptions | A numerical reference model before AMM/lending contract implementation |
| 5. Adversarial depth | Attacks on mechanisms already understood, audit method, invariant/fuzz testing, exploit reconstruction | Break your own systems, explain the failure, repair and defend them |
| 6. Execution and performance depth | Advanced EVM, gas, assembly, compiler behavior and selected verification | Investigate a real implementation question and compare measured alternatives |
| 7. Specialization strands | Advanced DeFi, governance, account abstraction, MEV, cross-chain, L2s, ZK and other frontier topics | Choose a strand with its real dependencies and a bounded product or research exercise |

These stages can overlap. Basic security starts with the first contract; EVM concepts appear whenever language behavior needs them; deep EVM and formal verification can continue later. “Spiral” should mean returning with harder questions, not repeatedly delivering the same introductory explanation.

For DeFi in particular, an API-level understanding is insufficient. For each mechanism, explicitly cover its balance sheet, units and rounding, invariants, assumptions about prices and time, who can lose money, and behavior under stress. Your AMM and lending briefs already make room for this; use them.

### Freshness should be maintained selectively

On the review date, 12 source options across nine topics had exceeded their own authored refresh windows. They concern L2 risk, incident feeds, Pyth, EigenLayer/EigenCloud, Noir/ZK verification, fault proofs and sequencer/batcher operations. “Refresh due” does not mean the source is wrong.

Refresh those moving parts and record versions for labs. Stable concepts need less frequent checking. Moving aliases such as [Solidity's latest documentation](https://docs.soliditylang.org/en/latest/security-considerations.html) may describe a different compiler from your exercise. The official [Ethereum roadmap](https://ethereum.org/roadmap/) and relevant EIPs are suitable places to verify protocol state. Do not turn source maintenance into rereading hundreds of URLs every month.

## 6. Projects: keep the catalogue, make the commitment smaller

The [project catalogue](/Users/dmitrijgorbatenko/personal/consistency/content/projects/web3-products.json) is one of the strongest parts of the setup. It asks for concrete deliverables, acceptance criteria, an architecture decision, a failure drill and independent defense. All milestone topic references resolved to existing curriculum topics.

The wallet's stale-response handling, the indexer's reorg/recovery model, escrow liabilities, AMM rounding and lending solvency are serious engineering exercises. They can produce stronger evidence than a sequence of tutorial clones if you actually own the decisions and implementation.

| Project | Build estimate | Recommended place |
|---|---:|---|
| Wallet & transaction operations console | 36–61 h | First product; begin with the bounded read-only slice |
| Reorg-aware indexer & portfolio API | 30–48 h | Early core; connects Web3 to databases and distributed-system reasoning |
| Escrow, invoices & payment settlement | 31–50 h | Early core; contract state, authorization, liabilities and adversarial behavior |
| Token distribution, vesting & claims | 30–47 h | Keep after core contract/accounting experience; useful before related token/vault work |
| Verifiable raffle & randomness operations | 34–53 h | Later focused study of randomness and operations; not a universal prerequisite |
| Signed-order marketplace & settlement engine | 31–49 h | Later signature/settlement specialization |
| AMM exchange & liquidity analytics | 35–55 h | Core DeFi direction after the needed contract, accounting and indexing concepts |
| Collateralized lending & ERC-4626 vault | 43–68 h | Follow AMM and relevant distribution/accounting concepts; preserve the economic depth |
| Governed treasury & upgrade lifecycle | 32–50 h | Later governance and lifecycle work |
| Smart-account wallet & gas sponsorship | 42–66 h | Later account-abstraction strand with its actual governance/signature prerequisites |
| Cross-chain order fulfillment & recovery | 36–57 h | Advanced specialization after single-chain reliability is comfortable |
| Production-style capstone & hiring evidence | 53–88 h | Synthesis after several substantial systems; not merely catalogue item 12 |

My suggested initial sequence is wallet → indexer → escrow, followed by the DeFi branch, bringing in distribution concepts where needed. Keep the other projects in the long-term plan. They do not all need to be active, and finishing all twelve is not a condition for meaningful progress.

At four project hours per week, the catalogue's current estimates alone amount to roughly 108–173 weeks. That is arithmetic, not a completion forecast: estimates exclude separate deep study and will change with reuse and experience. Re-estimate after two milestones.

Reuse the wallet, indexer and testing knowledge in later systems instead of rebuilding every generic screen and infrastructure component. Prefer extending one coherent product when that exposes a new concept clearly; use a separate exercise when isolation makes the mechanism easier to understand.

For architecture, retain a short decision record: constraints, alternatives, choice, cost, and what change would invalidate it. Then introduce a changed requirement. Being able to modify a design is stronger evidence than reciting architecture vocabulary.

The project conduct already tells the learner to write assessed core code and records help as independent, hints, pairing or generated. Preserve this. Generated scaffolding can save time, but independently explain and change the part whose understanding is being assessed.

## 7. DSA and broader engineering foundations

The DSA material covers the expected families: hashing, pointers/windows, stacks, binary search, linked structures, trees/tries/heaps, graphs, backtracking, dynamic programming, greedy methods, intervals and bit operations. Its 161 problem prompts provide substantial practice.

Its weakness is that a pattern catalogue can encourage “recognize the template” without developing the underlying model. None of the 81 DSA learning topics has the structured source plan used in Web3. Add a small foundation sequence: representation, complexity, invariants, induction, recursion, proof of correctness and tradeoffs. Include unlabeled mixed problems and later variants where the familiar pattern does not apply.

[MIT 6.006](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/) is a good source for this foundation. Use selected lectures and problems to strengthen the existing path, rather than maintaining two separate algorithm curricula and duplicate card collections. Start with a brief diagnostic to choose depth; do not equate prior employment with already knowing the theory.

For the broader engineering ambition, add material through real questions and one substantial foundation track at a time:

| Foundation | Trigger in your work | Appropriate source and scope |
|---|---|---|
| Database correctness | Indexer cursor updates, duplicate handling, recovery and concurrent writes | PostgreSQL's [transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html), exercised against your actual DB version. Later, selected material from [CMU's database courses](https://db.cs.cmu.edu/courses/) |
| Operating systems | Processes, memory, concurrency, persistence and performance | Selected [OSTEP](https://pages.cs.wisc.edu/~remzi/OSTEP/) chapters and exercises; expand into a deeper track if needed |
| Networking | RPC failures, latency, connections and delivery assumptions | A dedicated networking block; [Stanford CS144](https://web.stanford.edu/class/cs144/) is a substantial course, not a small side task |
| Distributed systems | Reorgs, replication, idempotency, partial failures and consistency | First derive behavior in your indexer; later [MIT 6.5840](https://pdos.csail.mit.edu/6.824/general.html), which requires significant time and preparation |
| Software design | Interfaces, complexity, change propagation and maintainability | Apply ideas from [A Philosophy of Software Design](https://web.stanford.edu/~ouster/cgi-bin/aposd.php) to an actual module and changed requirement |

These are proposed additions based on your goals, not requirements explicitly imposed by your original message. Do not enroll in all of them simultaneously. A serious foundation course should replace part of the existing weekly allocation while active, rather than simply increasing total workload.

## 8. What the existing practice repository demonstrates

The inspected [web3-practice repository](/Users/dmitrijgorbatenko/personal/web3-practice) contains focused hashing/address work, a four-leaf Merkle example with a runnable check, sign/recover work, explanatory notes and a small Foundry scaffold.

The sign/recover exercise includes assertions for recovered identity, a changed message and distinctions between raw hashing and prefixed signing. The Merkle check tests a valid proof and several mutations. These are useful early artifacts.

The limits are specific:

- The Merkle implementation is scoped to four leaves and a proof for one position. It does not yet demonstrate the broader all-leaf/odd-leaf/general proof behavior suggested by the full exercise. This can be a valid intermediate checkpoint, provided the completion claim has the same scope.
- The package's ordinary test command runs Foundry; it does not run the TypeScript Merkle check. The latter passed when run explicitly during this review.
- The Solidity scaffold tests a trivial arithmetic assertion, so it is not evidence of contract behavior yet.
- The address-derivation exercise logs values for comparison rather than asserting the claimed equivalence automatically. Add one direct equality check when completing that lab.
- The hashing exercise logs private-key material and account objects. I did not establish that these are real funded credentials. Use unmistakably public test fixtures and remove key logging before sharing output; no key values are reproduced here.

I would tighten the existing exercises and make the normal test entry point run meaningful checks. I would not build a large assessment framework around a handful of labs.

## 9. A durable note system using the tools you already have

Assign each tool one clear job:

| Tool | Job |
|---|---|
| Terrain | What to study next, recall scheduling, compact learning state, evidence and continuation |
| Obsidian | Canonical explanations, connections, counterexamples and a navigable personal reference |
| OneNote | Handwritten derivations and diagrams, linked from the canonical note |
| Practice/product repository | Executable examples, tests, measurements, decisions and failure reproductions |
| AI conversation | Dialogue and feedback; preserve its useful results elsewhere |

A compact topic note can contain:

1. The question the concept answers.
2. Your explanation and a diagram or worked trace.
3. Preconditions and invariants.
4. A small example and a counterexample/failure case.
5. What you originally misunderstood and what changed your model.
6. Links to the source/version, executable artifact and related concepts.
7. One unresolved question and the next useful test of understanding.

Do not fill every heading mechanically when it adds no value. Update one canonical note as understanding changes; avoid collecting a new AI summary after every conversation without reconciling it with the previous one.

At the end of a session, explain the key idea before looking at the source, then check and correct the note. Keep review questions separate from their answers. Each week, connect a few notes through a meaningful relationship: prerequisite, contrast, shared invariant, or application. Obsidian links are sufficient to start; a separate graph engine would not solve the intellectual work.

## 10. The learning loop and an achievable routine

### Why this loop

Retrieval practice and distributed practice have strong support for retention. [Dunlosky and colleagues' review](https://journals.sagepub.com/doi/10.1177/1529100612453266) rates practice testing and distributed practice highly; [Roediger and Karpicke's experiments](https://pubmed.ncbi.nlm.nih.gov/16507066/) distinguish delayed retention from the confidence produced by repeated study. Neither result makes a familiar flashcard a complete test of engineering competence.

Transfer to a different task is conditional. [Pan and Rickard's meta-analysis](https://rickardlab.ucsd.edu/pdf/PR_2018.pdf) supports taking the form of practice and the target task seriously. Include explanation, implementation, diagnosis and changed cases, not only repeated answers.

AI assistance also needs a later independent check. A [2025 randomized study of mathematics tutoring](https://doi.org/10.1073/pnas.2422633122) found that unrestricted generative-AI assistance could improve practice performance while harming later unaided performance; a guarded tutoring design mitigated that problem. The participants were high-school mathematics students, not experienced programmers. It motivates checking independence here, not projecting its exact effects onto your learning.

### Session conduct

Begin with the saved next step and a brief attempt or prediction. Study the relevant source or receive guided instruction. Explain the mechanism in your own words. Build, calculate or diagnose something that can be wrong. Compare with feedback, correct the model and save the evidence and next action.

Terrain already encodes much of this conduct. The key improvement is carrying the evidence through consistently, rather than adding more instructions to every prompt.

Keep help honest. Documentation can be allowed when the skill being assessed is engineering with documentation; hints or an AI-produced solution change the independence claim. Later, use a fresh variant under the agreed conditions. Do not rehearse the exact delayed assessment immediately before taking it.

### Illustrative 15-hour week

This fits your saved availability but is a starting allocation, not a scientific optimum.

| Activity | Hours |
|---|---:|
| Deep Web3 study and focused labs | 6 |
| One active project milestone | 4 |
| Bounded retrieval practice | 1.5 |
| DSA or the current broader-foundation track | 1.5 |
| Delayed independent check and weekly review | 1 |
| Consolidating and connecting notes | 1 |
| Total | 15 |

For a two-hour day, a useful default is 15 minutes of review, 90 minutes on one main objective and 15 minutes to consolidate and stop cleanly. Some days the main objective is theory; others it is project work. You do not need to touch every subject every day. An available third hour is optional capacity, not a new obligation.

This small foundation allocation is maintenance or gradual progress, not enough to run several university courses at normal pace. During a dedicated foundations block, move time from Web3 or projects into it.

Keep one primary topic and one project milestone active, with explicit stopping points. Once a week, inspect what you can do without help, what remains fragile and what produced little value. One delayed variant after roughly a week is a reasonable initial convention; adapt subsequent checks to evidence and difficulty. It is not a universal spacing prescription.

Useful progress questions are: Can I explain the model without the previous answer? Does my test catch the wrong implementation? Can I handle a changed constraint? Can I explain why I rejected an alternative? How much help did I need? Did my notes make it easier to resume? Counts and streaks support these questions; they do not replace them.

## 11. Changes in priority order

| Priority | Change | Observable success |
|---|---|---|
| 1 | Correct tutor reliability labels and prerequisite evidence | Failed recall is not unconditionally trusted; completed chapter evidence reaches the next session |
| 1 | Reproduce and diagnose the deployed connector failure | A normal and a topic-specific read return valid context, or a clear actionable error |
| 1 | Replace broad curriculum gates with real dependencies | Early wallet study can access RPC/viem; DeFi models can precede advanced DeFi attacks without bypassing essential concepts |
| 2 | Connect and surface existing notes | Open the canonical note from the topic; see a readable summary before management; find a remembered idea through search |
| 2 | Present recall, application and independent evidence distinctly | Historical completion is not presented as unconditional current competence |
| 2 | Normalize the study timezone and streak meaning | Queue, dashboard and calendar agree on a day; project work is not confused with review activity |
| 2 | Align labs, ordinary test commands and completion claims | A standard check exercises the actual artifact; recorded scope matches what was demonstrated |
| 3 | Refresh moving sources and contributor instructions | Versions and freshness are explicit without re-auditing every stable concept |
| Later | Bundle splitting or richer planning UI | Add only if observed friction remains after the simpler workflow is used |

A weekly view could eventually summarize existing topic, milestone and delayed-check data. First try the weekly routine with the current screens and a short note. Do not build a planning subsystem before discovering what information is actually missing.

## 12. What I would do over the next four weeks

**Week 1:** finish the current foundational learning objective to the agreed depth; take the already-pending delayed check without rehearsing its exact answer; configure the intended timezone and Obsidian link; keep the daily review slice bounded. Choose one canonical note and improve it using the structure above. Fix the two context defects before trusting stronger automatic adaptation.

**Week 2:** begin or continue wallet milestone W1 if its stated readiness conditions hold. Preserve the independent deep-study track. Record the design, a failing case and actual tests. Change the curriculum dependencies necessary to make its linked topics available; do not manually label unrelated phases learned to bypass a gate.

**Week 3:** resume from saved evidence, run one fresh independent variant of prior work, and complete or continue the same milestone. Introduce a small DSA foundation block, avoiding a second large simultaneous curriculum.

**Week 4:** review actual time and friction. Re-estimate the next milestone. Inspect whether notes help you reconstruct an explanation and whether failed recall is changing tutoring appropriately. Decide whether the next adjustment is workload, source depth, project scope or app behavior.

These are focus windows, not completion deadlines. If a topic needs another week of serious work, continue it. Do not compensate by accumulating more simultaneous work.

## 13. Verification and limits

No application code, learning state or curriculum content was changed for this review. Existing edits in `docker-compose.prod.yml` and `docs/ops/deploy.md` were left intact. The only new repository artifact is this report.

| Check performed during review | Result |
|---|---|
| Repository lint | Passed |
| Web3 structural validation | 24 import files; 462 topics; 526 prompts; zero reported errors or coverage gaps |
| DSA structural validation | 18 import files; 100 topics; 308 prompts; zero reported errors |
| Content/import script tests | 18 passed |
| Web tests | 73 passed in 9 files |
| Shared types tests | 40 passed in 4 files |
| Scheduling engine tests | 4 passed |
| API default suite | 605 passed; 44 failed across two HTTP controller suites with socket-listening `EPERM` errors, including a retry |
| API production type check and emission to a temporary output directory | Passed |
| Web type check and production build to a temporary output directory | Passed |
| Ordinary root build | Blocked while Nest tried to remove an existing generated directory; permission error, not established as a source-code defect |
| Broader API TypeScript check including the old end-to-end test | Failed on the callable `supertest` namespace import |
| Existing TypeScript Merkle check | Passed when invoked explicitly |
| Tutor-context and roadmap reproductions | Confirmed the reliability-classification, group-evidence and broad-gate behavior described above |
| Live Terrain connector | Two reads returned internal error `-32603`; cause undiagnosed |

The 44 API test failures do not establish 44 product defects, and the successful checks do not justify claiming the whole suite is green. The socket restriction prevented completing those HTTP tests in this environment.

There is a separate real maintenance issue in [app.e2e-spec.ts](/Users/dmitrijgorbatenko/personal/consistency/apps/api/test/app.e2e-spec.ts:3): the legacy test does not type-check and still expects a scaffold “Hello World!” response. Replace it with one meaningful authenticated study/export/import/resume flow rather than restoring the obsolete scaffold expectation. The production build excludes that test, which explains why production compilation can pass.

The review supports a targeted improvement programme: correct what the tutor assumes, align the curriculum with the project path, make notes easy to revisit, and validate independence over time. The current content and app are substantial enough to support that programme without another platform rewrite.
