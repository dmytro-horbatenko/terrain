// sdd-task.js — run ONE plan task through implement -> review -> fix, deterministically.
//
// A reusable Workflow script for subagent-driven development. For each task it:
//   1. dispatches a fresh IMPLEMENTER (TDD, from a file-based brief),
//   2. dispatches a fresh REVIEWER (spec compliance + code quality, structured verdict),
//   3. loops a FIXER over Critical/Important findings and re-reviews (<= maxFixRounds).
// It returns a compact verdict; the verbose subagent output stays out of the controller's context.
//
// USAGE (per task):
//   1. Edit the CONFIG block below (SCRATCH, REPO_DIR, TASK).
//   2. Run:  Workflow({ scriptPath: "<repo>/docs/superpowers/tooling/sdd-task.js" })
//   3. When it returns, the CONTROLLER independently verifies (run the task's tests + build itself —
//      ground truth, anti-fabrication), records the result in a durable ledger, then edits TASK for
//      the next task and re-runs. Tasks that touch shared files / DB / migrations MUST be sequential.
//
// WHY a literal config (not Workflow `args`): passing `args` alongside `scriptPath` proved unreliable
// in practice (it arrived empty, and the briefless implementer read the whole plan and over-built).
// A literal TASK block is guaranteed to reach the script.

export const meta = {
  name: 'sdd-task',
  description: 'SDD: implement one plan task (TDD), review (spec + quality), fix Critical/Important, re-review',
  phases: [
    { title: 'Implement', detail: 'fresh implementer writes test+impl from the brief' },
    { title: 'Review', detail: 'fresh reviewer judges spec compliance + code quality' },
    { title: 'Fix', detail: 'fix Critical/Important findings, then re-review' },
  ],
}

// ===================== PER-TASK CONFIG — EDIT BEFORE EACH RUN =====================
// Briefs + the constraints file live wherever you keep them. In a Claude Code session the scratchpad
// path is printed at session start; set SCRATCH to it (or to any dir you control).
const SCRATCH = '<SET ME: absolute path to the dir holding your task briefs + constraints file>'
const REPO_DIR = '<SET ME: absolute path to the repo root>'
const TASK = {
  taskName: 'Task N (short label)',
  briefPath: `${SCRATCH}/task-N-brief.md`,         // per-task brief: requirements + the exact code to write
  constraintsPath: `${SCRATCH}/_constraints.md`,   // project-wide constraints handoff (see constraints.template.md)
  changedFiles: [                                  // the files the reviewer reads (created/modified by this task)
    'path/to/file.ts',
    'path/to/file.spec.ts',
  ],
  testCommand: 'yarn test <filter>',               // covering test command (the fixer re-runs it)
  implementerModel: 'sonnet',                      // fast + reliable for transcription from a complete brief
  reviewerModel: 'opus',                           // scale to risk: opus for logic-heavy, sonnet for mechanical
  maxFixRounds: 2,
  skipImplement: false,                            // true => review-only over code already on disk (recovery)
  existingStateNote: '',                           // when skipImplement: describe the verified on-disk state
  repoDir: REPO_DIR,
}
// =================================================================================

const a = TASK
const maxFixRounds = a.maxFixRounds ?? 2
const implModel = a.implementerModel ?? 'sonnet'
const reviewModel = a.reviewerModel ?? 'opus'

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    redStep: { type: 'string', description: 'failing-test run summary (counts + why it failed), or n/a' },
    greenStep: { type: 'string', description: 'passing-test run summary with counts, or n/a' },
    buildResult: { type: 'string', description: 'build exit status/summary, or n/a' },
    extraVerification: { type: 'string', description: 'migration/smoke/curl output, or n/a' },
    concerns: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['status', 'filesChanged', 'redStep', 'greenStep', 'buildResult', 'concerns', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    specCompliance: { type: 'string', enum: ['pass', 'fail'] },
    specNotes: { type: 'string' },
    qualityApproved: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          file: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'title', 'detail'],
      },
    },
    cannotVerify: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['specCompliance', 'qualityApproved', 'findings', 'cannotVerify', 'summary'],
}

function implementerPrompt() {
  return `You are an implementer subagent executing ONE task of an implementation plan via strict TDD. Your returned object IS your report (no human reads a chat message) — fill every field with real evidence.

FIRST read these two files — together they are your COMPLETE instructions (read no other plan file):
1. Constraints & project facts (binding): ${a.constraintsPath}
2. Your task brief (requirements + the exact code to write VERBATIM): ${a.briefPath}

Follow the brief's steps IN ORDER. For a coded task that means strict red->green TDD:
- Write the test exactly as given; run the test command and SEE it FAIL for the right reason (red).
- Write the implementation exactly as given; run again and SEE it PASS (green).
- Do every registration / build / migration / smoke step the brief lists.

Rules:
- Work in ${a.repoDir}. Obey the constraints file (commit policy, toolchain, import/quote style).
- Implement ONLY this one task. Do NOT touch files the brief doesn't mention, and do not build other tasks' work.
- Report ACTUAL command output (counts, exit codes). NEVER fabricate. If a step genuinely fails beyond the brief's scope, set status=BLOCKED with details; if you need missing info, set status=NEEDS_CONTEXT.
- YAGNI: add nothing beyond the brief.`
}

function reviewerPrompt(report) {
  return `You are a code-reviewer subagent. Review ONE task's implementation for (1) SPEC COMPLIANCE and (2) CODE QUALITY. Be rigorous and adversarial but fair — do not rubber-stamp, do not invent issues.

Read these:
1. Constraints & project facts (binding): ${a.constraintsPath}
2. The task brief — this IS the spec: ${a.briefPath}
3. The actual files now on disk that this task created/modified:
${a.changedFiles.map((f) => '   - ' + f).join('\n')}

The implementer reported (evidence to corroborate against the files, not to trust blindly):
${JSON.stringify(report, null, 2)}

Review method:
- SPEC COMPLIANCE: does the code implement EXACTLY what the brief specifies — exact signatures, exact behavior, any required registration/wiring? The signatures in the brief's "Interfaces" section are a CROSS-TASK contract: verify them exactly. Flag anything MISSING (a requirement not met) and anything EXTRA (built beyond the brief / YAGNI).
- CODE QUALITY: correctness bugs, test hygiene (does each test actually assert the stated behavior?), constraint adherence (per the constraints file), naming, dead code, required error handling.
- Do NOT re-run the tests the implementer already ran on this same code; judge from the files + the report's evidence. But if the report's claimed evidence contradicts the files (a test that asserts nothing, a file not matching the brief, a fabricated count), flag it Critical.
- Severity: Critical = wrong/broken/spec-violating; Important = real defect to fix before merge; Minor = nit.
- If a requirement depends on code outside the listed files and you cannot confirm it, put it in cannotVerify (do not guess).

Return specCompliance (pass/fail), qualityApproved (bool), findings[], cannotVerify[], summary.`
}

function fixPrompt(review, blocking) {
  return `You are a fix subagent for ONE task. A reviewer found issues to fix.

Read first:
1. Constraints (binding): ${a.constraintsPath}
2. Brief (the spec): ${a.briefPath}

Reviewer's full verdict:
${JSON.stringify(review, null, 2)}

Fix EVERY Critical and Important finding listed here (also fix Minor ones if trivial and safe):
${JSON.stringify(blocking, null, 2)}

Rules:
- Stay strictly within the brief's scope and the constraints. Do NOT add features beyond the brief, and do NOT contradict the brief — if a finding asks you to violate what the brief explicitly mandates, do NOT change it; set status=DONE_WITH_CONCERNS and explain the conflict.
- After fixing, RE-RUN the covering tests (${a.testCommand}) and the build if relevant; report ACTUAL output with counts.

Your returned object IS your fix report. Fill filesChanged, greenStep (re-run output w/ counts), buildResult, summary (what you changed per finding), status.`
}

let report
if (a.skipImplement) {
  log(`${a.taskName}: skipImplement — reviewing pre-existing implementation on disk`)
  report = {
    status: 'DONE',
    filesChanged: a.changedFiles,
    redStep: 'n/a (implementation pre-existing / recovered)',
    greenStep: a.existingStateNote || 'pre-existing on disk',
    buildResult: 'see existingStateNote',
    extraVerification: a.existingStateNote || '',
    concerns: '',
    summary: 'Implementation already on disk; review-only run.',
  }
} else {
  phase('Implement')
  report = await agent(implementerPrompt(), {
    schema: IMPL_SCHEMA,
    model: implModel,
    effort: 'medium',
    label: `impl:${a.taskName}`,
    phase: 'Implement',
  })
  if (!report) return { taskName: a.taskName, fatal: 'implementer returned null (skipped or died)' }
  if (report.status === 'BLOCKED' || report.status === 'NEEDS_CONTEXT') {
    return { taskName: a.taskName, blocked: true, implReport: report }
  }
}

let review
let round = 0
while (true) {
  phase('Review')
  review = await agent(reviewerPrompt(report), {
    schema: REVIEW_SCHEMA,
    model: reviewModel,
    effort: 'high',
    label: `review:${a.taskName} r${round}`,
    phase: 'Review',
  })
  if (!review) return { taskName: a.taskName, fatal: 'reviewer returned null', implReport: report, fixRounds: round }
  const blocking = (review.findings || []).filter((f) => f.severity === 'Critical' || f.severity === 'Important')
  const clean = review.specCompliance === 'pass' && review.qualityApproved === true && blocking.length === 0
  log(`${a.taskName} review r${round}: spec=${review.specCompliance} quality=${review.qualityApproved} blocking=${blocking.length} minor=${(review.findings || []).length - blocking.length}`)
  if (clean || round >= maxFixRounds) break
  phase('Fix')
  const fixReport = await agent(fixPrompt(review, blocking), {
    schema: IMPL_SCHEMA,
    model: implModel,
    effort: 'high',
    label: `fix:${a.taskName} r${round}`,
    phase: 'Fix',
  })
  if (!fixReport) return { taskName: a.taskName, fatal: 'fixer returned null', implReport: report, review, fixRounds: round }
  report = fixReport
  round++
}

return { taskName: a.taskName, implReport: report, review, fixRounds: round }
