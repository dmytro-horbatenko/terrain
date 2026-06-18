# Write-from-Scratch Code Recall — Design

## Purpose

Terrain's review flow already gates a review behind a recall step
(`docs/superpowers/specs/2026-07-01-retrieval-prompts-design.md`, Stage 1 of
the learning-science roadmap): a due prompt shows its text, a free-text
scratch area, a Reveal button, and only then the quality rating. That scratch
area is a plain textarea meant for mentally working through an answer.

For coding-problem prompts specifically, research on DSA-focused spaced
repetition tools (LeetSRS, grind, DSAPrep) converges on a stronger recall
condition than "think about it": actually writing the solution from scratch,
closer to what an interview or real task demands. This is the first of three
sequenced review-loop improvements agreed with the user (write-from-scratch
recall → pattern graduation/dedup → FSRS algorithm swap, in that order —
smallest/lowest-risk first, biggest/most-invasive last since it settles
review-loop semantics before the scheduling algorithm underneath changes).

## Scope

In scope: a `promptKind` field on `Prompt` (`"concept"` | `"code"`), the
import-contract extension to author it, and a code-editor scratch area in
`ReviewGate` shown only for `"code"` prompts.

Out of scope: grading/execution of the written code (no in-app LLM calls,
per `CLAUDE.md`); persisting what was written (stays ephemeral, matching the
existing scratch textarea); pattern graduation/dedup and the FSRS swap
(next two stages, each gets its own spec).

## Data model

`Prompt` (`apps/api/prisma/schema.prisma`) gains one field:

```prisma
model Prompt {
  // ...existing fields unchanged...
  promptKind String @default("concept") // "concept" | "code"
}
```

Plain `String`, not a Prisma enum — matches how `packages/types` already
models these values as string unions (`ReviewMode`, `TopicStatus`) rather
than binding them to a DB-level enum; this field is a pure UI switch, so a
Prisma enum would just be migration overhead if a third kind is ever added
(e.g. `"design"` for system-design-style prompts). Existing `Prompt` rows
backfill to `"concept"` via the column default — no data migration script
needed, and their review UI is unchanged.

## Import contract extension

`packages/types/src/index.ts`:

```typescript
const proposedPromptSchema = z.object({
  topicTitle: z.string(),
  promptText: z.string(),
  answerHint: z.string().optional(),
  promptKind: z.enum(['concept', 'code']).default('concept'),
});
```

`apps/api/src/import/import.service.ts` persists `promptKind` on newly
created `Prompt` rows exactly like `promptText`/`answerHint` today — no
change to title-resolution or the all-or-nothing transaction logic.

The `SessionsService.export` OUTPUT_CONTRACT text (the ` ```learning-os `
JSON shape documented for Claude) gains one line: use `promptKind: "code"`
for prompts that ask for an algorithm/implementation to be written; leave
`promptKind` as `"concept"` (or omit it) for definitional/conceptual
questions.

## Web review flow

`apps/web/src/components/ReviewGate.tsx`:

- When `prompt.promptKind === 'code'`, render a `@uiw/react-codemirror`
  editor in place of the current plain `<textarea>` scratch box. New
  dependency — no code editor exists in this repo today. No language mode
  is bound (a prompt's solution could be in any language); use CodeMirror's
  `basicSetup` plus the `indentWithTab` keymap (`@codemirror/commands`) so
  Tab inserts a tab character instead of moving focus, matching the editing
  feel of an actual code editor.
- `'concept'` prompts — the default, and every prompt imported before this
  change — keep today's plain textarea untouched. Zero behavior change for
  existing prompts.
- The written code stays exactly as ephemeral as today's scratch text:
  local `useState`, cleared on prompt rotation (`useEffect` keyed on
  `prompt?.id`, already present), never included in the `POST /reviews`
  payload.

`LogReviewForm` and the `POST /reviews` contract are unchanged — this stage
only touches what's shown before Reveal, not what's submitted after.

## Testing

- `packages/types`: `learningOsSchema` parses `promptKind`; defaults to
  `'concept'` when the field is omitted from a `proposedPrompts` entry
  (backward-compat with session exports authored before this change).
- `apps/api`: `import.service.spec.ts` — new case asserting a `proposedPrompts`
  entry with `promptKind: 'code'` persists that value on the created
  `Prompt` row; existing cases (no `promptKind`) still pass and default to
  `'concept'`.
- `apps/web`: manual check via the existing Brave/CDP smoke script (no
  Playwright in this repo) — a `'code'` prompt renders the CodeMirror editor
  with working Tab-indent and no quality-picker pre-Reveal (regression
  check on the existing gate logic); a `'concept'` prompt, and an older
  prompt seeded before this change (no `promptKind` column value beyond the
  default), both still render the plain textarea.
