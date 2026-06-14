# DSA Learning Path — Design

## Purpose

Terrain has no starting content for a structured learning journey — it's a
scheduler/graph store, not a curriculum. This spec defines a comprehensive,
LeetCode/NeetCode-focused DSA learning graph to seed via the existing Topic +
Prerequisite + Import machinery, giving a detailed but navigable starting
point: broad enough to see the whole path today, granular enough to actually
study pattern-by-pattern without a second content pass.

No new API or schema code is introduced — this is a content-authoring +
import exercise on top of Phase 3 (Living Roadmap) and the Import feature.

## Scope

In scope: one root topic, 18 NeetCode-style categories, ~82 sub-pattern
topics, prerequisite wiring (linear + cross-cutting), curated problem lists
per sub-pattern, and reconciliation of the 16 pre-existing flat DSA seed
topics.

Out of scope: individual LeetCode problems as their own `Topic` rows (they
live as curated lists inside sub-pattern `description` fields instead);
non-DSA domains (web3, etc. — future specs); any new API endpoints or schema
changes.

## Data model mapping

Reuses `Topic` (`apps/api/prisma/schema.prisma:66-95`) and `Prerequisite`
(`schema.prisma:97-103`) as-is:

- **Root** — `title: "Data Structures & Algorithms"`, `domain:'DSA'`,
  `topicType:'concept'`, `parentId: null`. `description` holds the roadmap
  rationale and source attribution (NeetCode roadmap + Blind 75 + Grokking
  the Coding Interview pattern naming).
- **Category** (18 rows) — `parentId` → root, `topicType:'concept'`. One per
  NeetCode roadmap group (list below).
- **Sub-pattern** (~82 rows) — `parentId` → its category, `topicType:'pattern'`.
  **This is the reviewable unit**: SM-2 fields (`easeFactor`, `interval`,
  `repetitions`, `nextReviewAt`) get exercised at this level, not per-problem.
  `description` holds: pattern definition, recognition cues ("use this when
  you see..."), and 3–6 curated representative LeetCode problems with
  difficulty tags.
- **Prerequisite DAG** — category-level edges mostly follow NeetCode's linear
  roadmap order, corrected where the real dependency differs (e.g. Trees
  requires Stack for iterative traversal, and Linked List for recursive
  pointer-structure familiarity — not just "comes next in the roadmap").
  Sub-pattern edges default to a simple in-category chain (pattern N requires
  pattern N-1), plus explicit cross-category edges listed below where a real
  conceptual dependency exists.

`TopicType` rows for `concept` and `pattern` already exist from the seed
(`apps/api/prisma/seed.ts:9-18`) — no new type registration needed.

## Curriculum content

Root: **Data Structures & Algorithms**

1. **Arrays & Hashing** *(no prereqs — entry point)*
   Hashing fundamentals · Two Sum / complement lookup · Grouping by key
   (anagrams) · Prefix sums · Sorting-based array tricks

2. **Two Pointers** *(requires: Arrays & Hashing)*
   Opposite-direction pointers · Fast & slow pointers · Three-way
   partitioning (Dutch national flag)

3. **Sliding Window** *(requires: Two Pointers)*
   Fixed-size window · Variable-size/shrinkable window · Monotonic-deque
   window

4. **Stack** *(requires: Arrays & Hashing)*
   Monotonic stack · Valid parentheses/matching pairs · Expression
   evaluation (calculator, RPN) · Min-stack design

5. **Binary Search** *(requires: Arrays & Hashing)*
   Classic binary search · Binary search on answer · Search in rotated
   arrays · Binary search on 2D matrix

6. **Linked List** *(requires: Two Pointers)*
   Reversal · Fast & slow pointers (cycle/middle/palindrome) ·
   Merge/merge-k-lists · Dummy-node manipulation

7. **Trees** *(requires: Stack, Linked List)*
   DFS traversals · BFS/level-order · BST validation · Lowest common
   ancestor · Tree construction from traversals · Path-sum patterns ·
   Serialization/deserialization

8. **Tries** *(requires: Trees)*
   Trie construction & search · Word Search II/prefix matching ·
   Autocomplete applications

9. **Heap / Priority Queue** *(requires: Trees, Arrays & Hashing)*
   Kth largest/smallest · Top-K frequent elements · Merge-k via heap ·
   Two-heap median-finding *(requires: Kth largest/smallest)* · Task
   scheduling with heap

10. **Backtracking** *(requires: Trees, Arrays & Hashing)*
    Subsets/combinations · Permutations · Constraint satisfaction
    (N-Queens, Sudoku) · Grid backtracking *(requires: Graphs: DFS)* ·
    Palindrome partitioning

11. **Graphs** *(requires: Trees, Stack)*
    Graph representation · DFS (connected components/islands) · BFS
    (shortest path, multi-source) · Union-Find · Topological sort
    *(requires: Trees: DFS traversals)* · Cycle detection

12. **Advanced Graphs** *(requires: Graphs)*
    Dijkstra's *(requires: Heap: Kth largest/smallest)* · Bellman-Ford ·
    Floyd-Warshall · Minimum spanning tree *(requires: Union-Find)*

13. **1-D Dynamic Programming** *(requires: Backtracking, Arrays & Hashing)*
    Climbing stairs/Fibonacci · House robber · Longest increasing
    subsequence · Coin change · Decode ways/string DP · Word break

14. **2-D Dynamic Programming** *(requires: 1-D DP)*
    Grid path counting · Longest common subsequence *(requires: Longest
    increasing subsequence)* · Edit distance · 0/1 knapsack · Interval DP
    (burst balloons) · Palindromic subsequence DP

15. **Greedy** *(requires: Arrays & Hashing)*
    Interval scheduling · Jump game · Gas station · Greedy + sorting

16. **Intervals** *(requires: Greedy)*
    Merge intervals · Insert interval · Non-overlapping intervals ·
    Meeting rooms I & II

17. **Math & Geometry** *(requires: Arrays & Hashing)*
    Modular arithmetic/number theory · Matrix rotation · Prime sieve/GCD-LCM
    · Geometry basics

18. **Bit Manipulation** *(requires: Arrays & Hashing)*
    Basic bit ops · Counting bits · XOR tricks · Bitmask DP

~101 nodes total (1 root + 18 categories + 82 sub-patterns).

## Reconciling the existing 16 seed topics

The pre-existing flat seed (`apps/api/prisma/seed.ts:22-39`, `domain:'DSA'`,
`topicType:'concept'`) doesn't map 1:1 onto the structure above (e.g. it has
one combined "Two pointers & sliding window" row; the new structure splits
these). Per user decision, rebuild clean rather than reconcile/rename:

1. Before touching any row, query each of the 16 for review/app-event
   history.
2. Rows with history → `status:'archived'` (park, don't delete) per the
   Living Roadmap delete rule (`docs/superpowers/specs/2026-07-01-terrain-living-roadmap-design.md`
   — topics with history must be archived, not hard-deleted).
3. Rows with no history → hard-delete (cascades any `Prerequisite` rows,
   nulls out children's `parentId` — none expected here since the seed is
   flat).

## Delivery mechanism

No new code. Author one markdown file with a fenced ` ```learning-os ` JSON
block (`packages/types` `learningOsSchema`, validated by
`apps/api/src/import/import.service.ts`) containing all ~101
`proposedTopics[]` entries, wired via `parentTitle` and
`prerequisiteTitles[]` per the structure above. Each sub-pattern's
`description` includes the pattern write-up and 3–6 curated LeetCode
problems (drawn from NeetCode 150 / Blind 75 / Grokking-the-Coding-Interview
naming).

Import flow:

1. `POST /sessions/import/preview` (dry run) — verify node/edge count,
   check for title collisions against surviving old seed rows, check for
   422s (cycles, ambiguous/missing title refs).
2. Fix any reported issues in the source markdown, re-preview.
3. `POST /sessions/import` for real — all-or-nothing transaction.

## Verification

- Reload `/roadmap` filtered to `domain:'DSA'` — confirm an 18-branch DAG
  off the single root, no orphaned or cyclic nodes.
- Spot-check a handful of `parentId` chains and cross-category prerequisite
  edges directly via Prisma (e.g. confirm "Topological sort" really has
  "Trees: DFS traversals" as a prerequisite, not just its own category
  parent).
- Confirm the 16 old seed rows are gone or archived as decided in step 2
  above, with no dangling references.
