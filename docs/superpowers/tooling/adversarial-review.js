// adversarial-review.js — multi-lens find -> refute-verify -> synthesize.
//
// A reusable Workflow script for adversarially reviewing an artifact and keeping only findings that
// survive a skeptical second pass. Use it on any of:
//   - a DESIGN SPEC  (before writing the plan)   — lenses: completeness, consistency, feasibility-vs-code, master-spec alignment
//   - an IMPLEMENTATION PLAN (before coding)      — lenses: code-correctness (will the plan's code build + its tests pass?), type/spec consistency
//   - the IMPLEMENTED CODE on a branch (after)    — lenses: correctness, integration, spec-coverage, security/data
//
// Each LENS spawns one opus finder; each finding is then verified by an independent refute-biased
// skeptic (default REFUTE — only CONFIRM if it reproduces). Returns the confirmed findings, ranked.
// The controller then triages: fix Critical/Important; surface Minors / plan-contradictions to the human.
//
// USAGE: edit the CONFIG block (SUBJECT, the file paths, and LENSES), then
//   Workflow({ scriptPath: "<repo>/docs/superpowers/tooling/adversarial-review.js" })

export const meta = {
  name: 'adversarial-review',
  description: 'Multi-lens adversarial review (spec / plan / code): find -> refute-verify -> synthesize',
  phases: [
    { title: 'Find', detail: 'one opus finder per lens' },
    { title: 'Verify', detail: 'refute-biased verifier per finding' },
  ],
}

// ========================= CONFIG — EDIT BEFORE EACH RUN =========================
const REPO_DIR = '<SET ME: absolute path to the repo root>'
// What is under review (one short sentence the agents see), and the files each lens may read.
const SUBJECT = 'the implementation of <FEATURE> (NestJS + Prisma, etc.)'
const PRIMARY = ['<the spec or plan file under review, if any>'] // e.g. docs/.../my-design.md ; [] for pure code review
const CODE = [                                                   // source/schema files to corroborate against
  'path/to/changed/file.ts',
  'path/to/schema-or-contract',
]
// Already-accepted items the finders should NOT re-report unless genuinely more severe than stated.
const KNOWN = `KNOWN/ACCEPTED (do not re-report unless MORE severe than stated):
- <style convention X is intentional>
- <design decision Y is by design>`
// One finder per lens. Make each focus concrete and bounded.
const LENSES = [
  { key: 'correctness', focus: `LOGIC/CORRECTNESS. Read ${[...PRIMARY, ...CODE].join(', ')}. Trace the hardest paths (edge cases, ordering, concurrency, off-by-one, null handling). Flag real bugs with a CONCRETE failing input.` },
  { key: 'integration', focus: `WIRING + EXTERNAL CONTRACTS. Read ${CODE.join(', ')}. Verify DI/module graph resolves, and every external/library/DB call matches the real API and schema. Flag anything that throws at runtime.` },
  { key: 'spec-coverage', focus: `SPEC COVERAGE. Read ${PRIMARY.join(', ')} and ${CODE.join(', ')}. Confirm each spec requirement is implemented; flag any MISSING requirement or any behavior that CONTRADICTS the spec, and any scope creep.` },
]
const FINDER_MODEL = 'opus'
const VERIFIER_MODEL = 'opus'
// ================================================================================

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          detail: { type: 'string' },
          failureScenario: { type: 'string', description: 'concrete inputs/state -> wrong output/crash' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'title', 'detail'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED'] },
    severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'severity', 'reason'],
}

function finderPrompt(lens) {
  return `You are doing an adversarial review of ${SUBJECT} at repo root ${REPO_DIR}. Lens: ${lens.key}.

${lens.focus}

${KNOWN}

Report ONLY real, defensible findings, each with a CONCRETE failureScenario (specific input/state -> wrong result/crash) and a suggested fix. Prefer Critical/Important; do not pad with style nits. Return an empty array if your lens is clean. Do not invent issues to look thorough.`
}

function verifierPrompt(f) {
  return `You are an adversarial verifier. Default to REFUTE; CONFIRM only if you reproduce the failure in the real artifact yourself.

CLAIM (${f.severity}): ${f.title}
File: ${f.file || 'n/a'}${f.line ? ' :' + f.line : ''}
Detail: ${f.detail}
Failure scenario: ${f.failureScenario || '(none given)'}

Read the actual files at repo root ${REPO_DIR} and trace the claimed scenario against the real artifact. CONFIRMED only if it genuinely occurs (a real bug / a real spec gap / genuinely won't build); else REFUTED. Assign the severity YOU think correct. One-paragraph reason citing specific lines/text.`
}

phase('Find')
const perLens = await pipeline(
  LENSES,
  (lens) => agent(finderPrompt(lens), { schema: FINDINGS_SCHEMA, model: FINDER_MODEL, effort: 'high', label: `find:${lens.key}`, phase: 'Find' }),
  (res, lens) => parallel((res?.findings || []).map((f) => () =>
    agent(verifierPrompt(f), { schema: VERDICT_SCHEMA, model: VERIFIER_MODEL, effort: 'high', label: `verify:${lens.key}:${(f.title || '').slice(0, 26)}`, phase: 'Verify' })
      .then((v) => ({ lens: lens.key, ...f, verifiedSeverity: v?.severity, verdict: v?.verdict, verifierReason: v?.reason }))
      .catch(() => null))),
)

const all = (perLens || []).flat().filter(Boolean)
const confirmed = all.filter((f) => f.verdict === 'CONFIRMED')
const refuted = all.filter((f) => f.verdict === 'REFUTED')
const rank = { Critical: 0, Important: 1, Minor: 2 }
confirmed.sort((a, b) => (rank[a.verifiedSeverity || a.severity] ?? 3) - (rank[b.verifiedSeverity || b.severity] ?? 3))
log(`review: ${all.length} raw -> ${confirmed.length} confirmed, ${refuted.length} refuted`)
return {
  confirmedCount: confirmed.length,
  refutedCount: refuted.length,
  confirmed,
  refutedTitles: refuted.map((f) => `[${f.lens}] ${f.title}`),
}
