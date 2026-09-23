export const OUTPUT_CONTRACT = `## OUTPUT CONTRACT — return exactly one fenced block

Keep this bookkeeping out of the teaching conversation. When the session ends, output ONE fenced code block tagged \`learning-os\` containing this JSON
(prose may surround it; only the LAST such block is parsed):

\`\`\`learning-os
{
  "version": 2,
  "sessionId": "<echo the Session id from this export header>",
  "reviews": [
    { "promptId": "<id of a card actually attempted>", "grade": "good", "note": "first attempt; help; correction if any" },
    { "topicTitle": "<exact title — session-level evidence only, moves no schedule>", "grade": "hard" }
  ],
  "proposedTopics": [
    { "title": "...", "type": "pattern", "domain": "DSA", "description": "...",
      "prerequisiteTitles": [], "parentTitle": null, "aiContext": "why proposed" }
  ],
  "proposedPrompts": [
    { "topicTitle": "<exact title, existing or from proposedTopics>",
      "promptText": "...", "answerHint": "optional",
      "promptKind": "concept | code | problem",
      "url": "https://leetcode.com/problems/... (problem kind only)",
      "problemDifficulty": "easy | medium | hard (problem kind only)",
      "estimatedMinutes": 15 }
  ],
  "noteSummaries": [
    { "topicTitle": "...", "keyInsight": "Objectives: ...; Independent: ...; With help: ...; Unresolved: ...; Next: ...",
      "invariant": "only when genuinely sharp", "contradiction": "only when real",
      "suggestedNoteRef": "Obsidian: DSA/Stacks/Monotonic" }
  ],
  "applicationEvents": [
    { "topicTitle": "<exact title, existing or from proposedTopics>",
      "kind": "problem_solved | project_usage | audit_exercise | real_debugging",
      "description": "what I actually did/solved",
      "url": "https://leetcode.com/problems/... (optional)" }
  ],
  "sourceEvidence": [
    { "topicTitle": "<exact title>", "requirementId": "<SOURCE PLAN requirement id>",
      "sourceId": "<curated option id>", "sourceTitle": "...", "sourceUrl": "https://...",
      "mainClaim": "what I reconstructed", "supportingMechanism": "what I reconstructed",
      "openQuestion": null, "substitutionReason": null, "verifiedLiveAt": null,
      "verificationNote": null }
  ],
  "studiedTopics": ["<exact title whose agreed learning objectives are complete>"],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: grade is one of again|hard|good|easy — the user's own recall verdict, never yours.
Only grade an actual retrieval attempt made before hints or answers, with the user's explicit
self-rating of that first attempt. A discussion, copied solution or corrected answer does not
earn a recall grade. Record at most one review per promptId; no second grade for a correction.
Follow the session's agreed scope; existing cards are not a compulsory quiz during learning.
Prefer promptId reviews; use topicTitle-only reviews only for actual self-rated retrieval
outside any listed card. In note (max 2000 characters), capture the specific original gap or
reasoning, assistance, and correction; distinguish observations from learner reports.
applicationEvents: record only things the user genuinely did this session (solved a novel
problem, used it in a project) — one such event satisfies the topic's mastery application
condition, so do not fabricate them.
sourceEvidence: entries describe what the learner actually reconstructed, not the assistant's
summary. Record only new reconstructions from this session; do not copy historical entries.
Credited evidence for an unfinished planned topic is reused by import automatically. Copy
requirementId and sourceId exactly from stored SOURCE PLAN entries. If no stored
requirement exists, emit no sourceEvidence entry for it. Curated sources include sourceId and
have substitutionReason null. Replacements omit sourceId and require a non-null
substitutionReason. Expired curated sources require both
verifiedLiveAt and verificationNote after live verification; otherwise both fields are null.
noteSummaries: keyInsight is a cumulative handoff of at most 2000 characters, not a transcript.
Use Objectives / Independent / With help / Unresolved / Next as prose labels where useful,
not new JSON fields. Preserve prior demonstrated work and the agreed depth objectives;
update resolved gaps. Capture actual reasoning mistakes, help received, what remains unknown,
and one precise resume point. Do not squeeze this into 1–2 sentences or claim independent
success from a correction. Omit unchanged summaries; they replace the previous topic summary.
Offer fuller notes when useful or requested; they are not required to stop. suggestedNoteRef
names existing notes. Include any secondary artifact reference inside the summary prose.
nextSession: use the exact topic title and put the unfinished objective and next action in
coldChallenge; a cold question is optional when it helps. If a topic is listed in studiedTopics,
do not use that same topic as nextSession.focusTitle; omit nextSession or choose the next topic.
Do not replace unfinished study with
a delayed skill-check suggestion or append an obligatory quiz.
studiedTopics: titles whose agreed learning objectives are now complete — a planned topic
listed here is activated on import (its successors unblock). In a learning session, use the
SESSION CONDUCT's completion rules; recorded work across sessions can satisfy them. Partial
reading/derivation belongs in noteSummaries and nextSession, with studiedTopics empty.
Do not list topics merely mentioned. Usually propose zero to two useful new cards; reuse
existing prompts and omit proposals when nothing new is needed.
Omit unused arrays or use []. Do not add fields outside this schema — the parser
is strict and will reject the whole block. Keep each prompt atomic — one fact or concept per
prompt. promptKind: "code" = write an implementation from scratch; "problem" = a concrete
practice problem (include url + problemDifficulty + estimatedMinutes).`;

export const REPEAT_OUTPUT_CONTRACT = `## OUTPUT CONTRACT — repetition
Keep bookkeeping out of the conversation until we stop. Return exactly one fenced
block tagged \`learning-os\`, using this shape:
\`\`\`learning-os
{
  "version": 2,
  "sessionId": "<echo the Session id from this export header>",
  "reviews": [
    { "promptId": "<attempted card id>", "grade": "again", "note": "First attempt: ...; Help: ...; Correction: ..." }
  ]
}
\`\`\`
Include only cards actually attempted with my explicit self-grade of the original
attempt before help: again|hard|good|easy. Preserve that grade after correction.
One entry per promptId; no entries for unattempted or ungraded cards. Use reviews: []
if none were graded. Each note is at most 2000 characters and describes the actual
reasoning/gap, help and correction, distinguishing observed from reported evidence.
Do not infer mistakes from grades or invent independent success. Put a useful later
practice suggestion in the relevant review note; it does not schedule a skill check
or replace unfinished topic study. Omit other arrays. Do not add unlisted fields.
Stopping is valid at any point; emit this partial record immediately when asked.`;
