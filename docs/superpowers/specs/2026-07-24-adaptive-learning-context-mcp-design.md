# Adaptive Learning, Explainable Roadmaps, and MCP Context

- **Date:** 2026-07-24
- **Status:** Design approved; implementation not started
- **Owner:** Dima
- **Scope:** Roadmap progression, topic-directed learning sessions, adaptive
  teaching modes, a canonical learning-context endpoint, and a read-only remote
  MCP adapter

## 1. Problem

Terrain currently has three related failures.

1. **Roadmap progression is too permissive.** A planned topic becomes startable
   when each direct prerequisite is merely `active` or `mastered`. In the Web3
   curriculum, `Accounts, transactions & gas` depends on the `Blockchain
   basics` chapter node. Once that chapter node becomes active, Accounts can be
   selected even when only 5 of its 13 leaves have been studied.
2. **The normal learning flow hides choice.** `mode=learn` exports already accept
   an explicit `focusTopicId`, and the Export screen exposes it, but the daily
   session wizard only starts the global Next Up topic. A learner cannot simply
   click an unlocked roadmap topic and study it.
3. **The AI receives an incomplete model of the learner.** Session exports carry
   the focus and nearby roadmap context, but they do not provide one structured,
   explainable account of what Terrain believes is known, uncertain, blocked,
   or safe to assume. This causes both redundant teaching and unexplained jumps
   over missing foundations.

The current learning conduct also hard-codes one source-first ritual. It says
“do not teach before required source reconstruction,” which prevents the
desired guided experience for difficult topics: detailed explanation,
Socratic questioning, implementation work, tests, and progressively harder
challenges inside the chat.

## 2. Goals

- Do not unlock a dependent chapter until every leaf in its prerequisite
  chapter has completed at least one learning session.
- Keep full FSRS mastery independent from curriculum progression; a learner
  must not wait weeks for retention stability before reaching the next chapter.
- Let the learner start any unlocked leaf directly from its topic drawer.
- Offer two explicit learning approaches: `guided` and `source-first`.
- Recommend an approach using a small, explainable rule while always allowing
  an override.
- Produce one compact structured context that explains selection, blockers,
  prerequisite knowledge, uncertainty, and relevant learning evidence.
- Reuse that context for the diagnostic REST endpoint, session exports, and one
  read-only MCP tool.
- Keep all context user-scoped and authenticated.

## 3. Non-goals

- Write-capable MCP tools.
- Autonomous grading or allowing the AI to record work the learner did not do.
- A vector database, embeddings, or a second AI-memory store.
- Dumping the entire roadmap or all review history into every session.
- Requiring every topic to reach `mastered` before curriculum progression.
- Replacing FSRS, the existing `learning-os` import contract, or the session
  copy/paste workflow in this iteration.
- A separate MCP service, container, or deployment.

## 4. Roadmap semantics

### 4.1 Terms

- **Leaf:** a topic with no children. Leaves are the studyable units.
- **Group:** a topic with at least one child. Groups organize the roadmap and
  are never Next Up candidates.
- **Learned leaf:** a leaf whose status is `active` or `mastered`. Importing a
  completed learning session already activates a planned studied topic.
- **Unfinished leaf:** a leaf whose status is `planned` or `archived`.
- **Satisfied prerequisite:** a prerequisite that passes the rules below.
- **Learnable:** a planned leaf whose direct prerequisites are all satisfied.

### 4.2 Prerequisite satisfaction

For each direct prerequisite of a planned leaf:

1. A prerequisite leaf is satisfied when its own status is `active` or
   `mastered`.
2. A prerequisite group is satisfied only when **every descendant leaf** is
   `active` or `mastered`.
3. A planned or archived descendant leaf blocks its prerequisite group.
   Archiving remains an explicit “not learned” decision; it must not silently
   count as curriculum completion.
4. A group with no descendant leaves falls back to its own status.
5. Traversal is recursive so additional hierarchy levels do not change the
   policy.

This produces the intended Web3 behavior:

```text
Blockchain basics: 5/13 leaves learned
Accounts, transactions & gas: blocked
Reason: 8 prerequisite leaves remain unfinished
```

### 4.3 One shared policy

Implement the hierarchy and eligibility calculation as pure functions over a
flat, user-scoped topic graph:

```ts
type RoadmapNode = {
  id: string;
  parentId: string | null;
  status: TopicStatus;
  prerequisiteIds: string[];
};
```

The result is an eligibility map keyed by topic ID with:

- `kind: 'leaf' | 'group'`
- `learned`
- `learnable`
- `satisfied`
- descendant totals
- unfinished descendant IDs
- direct blocker IDs and human-readable reasons

`MetricsService`, `TopicsService`, the export generator, and
`LearningContextService` consume this same result. No caller keeps a second
definition of “blocked” or “startable.”

### 4.4 Next Up

Next Up remains a single recommendation:

1. Build the learnable frontier from enabled domains.
2. Resolve the latest imported `nextSession.focusTitle`.
3. Accept it only when it resolves case-insensitively to a learnable planned
   leaf in scope.
4. Otherwise record its rejection reason and fall back to authored creation
   order (`createdAt asc`, `id asc`).
5. Return `null` when no learnable leaf exists.

The imported focus remains advisory. It cannot override prerequisite policy,
domain disabling, archived state, or the leaf-only rule.

## 5. Direct topic learning

### 5.1 Topic actions

The topic drawer gains:

- **Learn this** for a planned, learnable leaf.
- A blocker summary for a planned, blocked leaf.
- **Deepen this** for an active or mastered leaf.
- No learning action for a group or archived topic.

The Roadmap and Topics screens reuse the same drawer, so one implementation
covers both surfaces.

### 5.2 Routed session focus

The learning-session route accepts typed search parameters:

```text
/session/learn?topic=<topic-id>&approach=guided|source-first
```

The wizard passes `focusTopicId` into the existing export mutation. An explicit
focus must remain explicit through export generation and persistence; it must
never silently fall back to global Next Up.

Pending learning sessions become focus-aware. The dashboard/session payload
includes the persisted focus ID and title. For a default learn session,
`createExport` persists the focus resolved by Next Up rather than leaving
`focusTopicId` null:

- Same mode and same focus: resume.
- Explicitly selecting a different focus: start a new export for that focus.
  The older unimported export remains historical but is no longer the latest
  pending session.

## 6. Adaptive teaching modes

### 6.1 Guided deep dive

Guided mode is for difficult, uncertain, code-heavy, or returning topics.

1. **Calibrate:** ask a small number of diagnostic questions before assuming
   prerequisite knowledge.
2. **Explain incrementally:** teach one mechanism at a time in enough detail to
   close the observed gap.
3. **Probe Socratically:** ask prediction, counterexample, invariant, and
   trade-off questions; wait for the learner’s response.
4. **Check misconceptions:** distinguish fluent wording from a correct mental
   model.
5. **Do:** require the learner to implement, debug, or solve a novel problem.
   The AI may review and suggest tests but must not write the learner’s answer.
6. **Stress:** add edge cases and progressively harder challenges.
7. **Teach back and record:** require a concise reconstruction, write the
   conspect, and emit the normal `learning-os` result.

Curated sources remain available as references, but source consumption is not a
gate. `sourceEvidence` is emitted only for sources the learner actually
consumed and reconstructed.

### 6.2 Source first

Source-first mode keeps the existing source-grounded ritual:

1. Select an applicable curated source or justified substitute.
2. Consume it outside the chat.
3. Reconstruct its claim, mechanism, and open question.
4. Synthesize multiple sources when applicable.
5. Teach back with sources closed.
6. Fill gaps Socratically.
7. Implement or solve a novel problem.
8. Produce the conspect and `learning-os` result.

### 6.3 Recommendation rule

The server returns `recommendedApproach` plus an ordered `reasons[]`. The rule
is deterministic:

1. Recommend **source-first** when an applicable source requirement is
   `requiredWhen: always` or has no non-expired curated option. Current,
   authoritative material wins over convenience.
2. Otherwise recommend **guided** when any of these is true:
   - the target is already `active` or `mastered`;
   - one of the last three reviews for the target or a direct prerequisite was
     graded `again` or `hard`;
   - the target has a non-suspended `code` or `problem` prompt;
   - the target has at least two applicable source requirements.
3. Otherwise recommend **source-first** for a planned topic with exactly one
   applicable required source.
4. Otherwise recommend **guided**.

The learner can override the recommendation before export generation. The
chosen approach is persisted on `SessionExport` so a resumed session uses the
same conduct script.

## 7. Canonical learning context

### 7.1 Endpoint

Add:

```http
GET /learning/context?topic=<topic-id-or-title>
```

The production URL is `/api/learning/context` through the existing Caddy
proxy. The route uses the current JWT-cookie authentication and current-user
scoping.

- With `topic`, resolve an owned topic by ID first, then case-insensitive title.
- Without `topic`, explain the current Next Up decision.
- Unknown topic: `404`.
- Ambiguous legacy title: `409`.
- No learnable Next Up: `200` with `target: null` and the blocking summary.
- Response header: `Cache-Control: private, no-store`.

### 7.2 Response shape

The exact TypeScript/Zod contract lives in `@terrain/types` and is versioned
independently from `learning-os`:

```ts
type LearningContext = {
  schemaVersion: 1;
  generatedAt: string;
  learner: {
    role: string | null;
    learningStyle: string | null;
    codeStyle: string | null;
    noteSystem: string | null;
  };
  target: null | {
    id: string;
    title: string;
    domain: string;
    topicType: string;
    kind: 'leaf' | 'group';
    sessionEligible: boolean;
    status: TopicStatus;
    description: string | null;
    sourcePlan: SourcePlan | null;
    chapter: null | {
      id: string;
      title: string;
      learnedLeaves: number;
      totalLeaves: number;
    };
    approach: {
      recommended: 'guided' | 'source-first';
      reasons: string[];
    };
    prompts: Array<{
      id: string;
      kind: PromptKind;
      text: string;
      state: CardState;
      difficulty: number | null;
      stability: number | null;
      lastGrade: Grade | null;
    }>;
  };
  selection: {
    source: 'explicit' | 'imported-focus' | 'authored-order' | 'none';
    importedFocus: null | {
      title: string;
      accepted: boolean;
      reason: string;
    };
    learnableAlternatives: Array<{ id: string; title: string; chapterTitle: string | null }>;
  };
  prerequisites: PrerequisiteContext[];
  mayRelyOn: KnowledgeContext[];
  doNotAssume: KnowledgeContext[];
  blockers: Array<{
    topicId: string;
    title: string;
    reason: string;
    learnedLeaves?: number;
    totalLeaves?: number;
    unfinishedLeaves?: Array<{ id: string; title: string; status: TopicStatus }>;
  }>;
};
```

`PrerequisiteContext` carries the recursive prerequisite tree, satisfaction,
descendant progress, summary, and compact evidence. `KnowledgeContext` carries
an explicit knowledge level:

- `unseen`: planned or archived;
- `introduced`: active with no review, source, summary, or application evidence;
- `practicing`: active with at least one such evidence signal;
- `mastered`: mastered.

`mayRelyOn` contains `practicing` and `mastered` prerequisite concepts.
`doNotAssume` contains `unseen` and `introduced` concepts, with a reason telling
the AI whether to teach or verify first.

Evidence is compact:

- latest relevant grades and review timestamps;
- prompt FSRS difficulty/stability;
- summary when present;
- source-evidence titles/count;
- application-event count and latest description.

Do not return email, password hashes, JWTs, OAuth tokens, full notes, unrelated
roadmap branches, or complete review histories.

### 7.3 Data flow

`LearningContextService` performs bounded, user-scoped queries and delegates
hierarchy decisions to the pure roadmap policy:

```text
Prisma data
  -> roadmap policy
  -> LearningContext
     -> diagnostic REST response
     -> learning export renderer
     -> MCP structured result
```

The learning export renders the approved context into concise markdown. It
does not independently re-query and reinterpret prerequisite eligibility.

## 8. Read-only remote MCP

### 8.1 Transport and tool

Mount the official MCP TypeScript SDK inside the existing Nest/Express API
process:

```text
POST/GET https://<terrain-domain>/api/mcp
```

Use stateless Streamable HTTP with JSON responses. No MCP session state,
resumability, notifications, separate process, or new container is needed.

Expose one tool:

```ts
get_learning_context({ topic?: string }): LearningContext
```

The tool is annotated read-only and returns `structuredContent` plus a JSON
text fallback. The optional topic accepts the same ID-or-title input as REST.

### 8.2 Authentication

The browser JWT cookie is not remote MCP authentication. The MCP phase adds an
OAuth 2.1 authorization-code flow with PKCE and only one initial scope:

```text
learning:read
```

`offline_access` may accompany it to request refresh-token issuance; it is a
protocol longevity scope, not an additional Terrain data permission.

The authorization screen reuses the existing Terrain login. Access and refresh
tokens are revocable: access tokens are short-lived signed JWTs carrying the
user ID and `learning:read` scope; refresh tokens and one-time authorization
codes are stored only as hashes. ChatGPT and Claude clients are pre-registered;
the first release does not expose open dynamic client registration. Discovery
metadata and protected-resource metadata follow the MCP authorization
specification.

Each access token also names its OAuth client, and the MCP guard checks an
active user-client grant. Disconnecting a client revokes that grant and its
refresh-token families, invalidating existing access immediately without
storing raw access tokens.

Authorization and token requests must carry the exact configured MCP
`resource` URI. Access tokens bind that URI as their audience, and the MCP guard
rejects tokens issued for any other resource. Production Caddy proxies the two
root `.well-known` discovery paths to the API while `/api/mcp` stays under the
existing API prefix.

No-auth mode, secrets in query parameters, and permanent bearer tokens are not
acceptable for production learning data.

The MCP route also:

- validates `Origin`/host against the configured Terrain domain;
- retains global throttling;
- uses `Cache-Control: private, no-store`;
- reports protocol-safe errors without stack traces;
- resolves every tool call to the authenticated Terrain user.

OAuth/MCP is a separate implementation slice so it cannot delay the roadmap,
session, and diagnostic improvements.

## 9. Error handling

- A malformed topic query receives `400`.
- A topic outside the authenticated user’s account is indistinguishable from a
  missing topic (`404`).
- A blocked explicit topic is returned in diagnostic context with blockers, but
  export generation rejects it with `422`.
- A group cannot start a learning session (`422`).
- An invalid approach value receives `400`.
- A stored imported focus that is missing or blocked is not an error; it is
  rejected in the selection trace and the normal fallback runs.
- A corrupted hierarchy cycle is reported as a bounded diagnostic blocker and
  never recursed indefinitely.

## 10. Verification

### Roadmap policy

- The exact Web3 fixture proves `Blockchain basics 5/13` keeps Accounts blocked.
- `13/13 active|mastered` unlocks Accounts.
- A planned or archived descendant still blocks.
- Nested groups recurse correctly.
- Direct leaf prerequisites preserve the current `active|mastered` rule.
- Category nodes never become Next Up.
- Imported focus cannot jump outside the learnable frontier.
- Disabled domains stay excluded.

### Learning flow

- A learnable topic drawer renders **Learn this** and passes its exact ID.
- A blocked topic renders its blocker and cannot generate an export.
- Active/mastered topics render **Deepen this**.
- Recommendation rules return their expected mode and reasons.
- An explicit override persists and controls the conduct script.
- Pending sessions resume only when mode and focus match.

### Context and isolation

- REST context is scoped to the authenticated user.
- Foreign IDs return `404`.
- The response identifies learned, uncertain, and unseen prerequisites from
  real evidence.
- Selection trace explains accepted and rejected imported focuses.
- The response omits secret/private fields and unrelated history.
- A cyclic bad-data fixture terminates safely.

### MCP

- OAuth scope/user isolation is enforced.
- `get_learning_context` equals the REST contract for the same user/topic,
  apart from transport metadata.
- The tool is read-only and has no mutation path.
- Origin/host checks, throttling, and protocol-safe errors work.
- MCP Inspector, Claude, and ChatGPT can connect to the production-style URL.

### Repository checks

- Targeted API and web tests.
- Full API tests and build.
- Web production build.
- Lint and formatting checks.
- Authenticated browser smoke for the diagnostic endpoint and topic-directed
  session.

## 11. Delivery slices

### Slice A — trustworthy progression

- Pure roadmap policy and exact regression fixture.
- Replace all current blocked/startable consumers.
- Explain blockers in existing topic payloads.

### Slice B — choose and adapt

- Topic-directed session route and drawer actions.
- Focus-aware pending sessions.
- Guided/source-first conduct scripts.
- Recommendation and override.

### Slice C — canonical context

- Shared `@terrain/types` contract.
- `LearningContextService`.
- Authenticated REST endpoint.
- Learn export consumes the same context.

### Slice D — remote access

- MCP SDK and one read-only tool.
- OAuth `learning:read`.
- Production connection smoke in MCP Inspector, Claude, and ChatGPT.

Slices A–C form the first implementation plan. Slice D receives its own
security-focused implementation plan after the diagnostic context is stable.

## 12. Success criteria

The feature is successful when:

1. Terrain cannot propose Accounts while Blockchain Basics is only 5/13.
2. The learner can start any unlocked leaf in two clicks or fewer.
3. A difficult topic can run as a guided Socratic deep dive without mandatory
   source consumption.
4. The AI can inspect a compact context and correctly state what it may rely on,
   what it must verify, and why the target is selected.
5. One authenticated endpoint is sufficient to diagnose roadmap selection
   without terminal access.
6. Claude and ChatGPT can later retrieve that same context through one
   read-only MCP tool without exposing Terrain anonymously.

## 13. External protocol references

- [MCP TypeScript SDK — server and Streamable HTTP](https://ts.sdk.modelcontextprotocol.io/server)
- [MCP transport specification](https://modelcontextprotocol.io/specification/draft/basic/transports)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [ChatGPT developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
- [Claude custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
