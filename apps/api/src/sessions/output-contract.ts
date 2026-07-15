export const OUTPUT_CONTRACT = `## OUTPUT CONTRACT — return exactly one fenced block

When the session ends, output ONE fenced code block tagged \`learning-os\` containing this JSON
(prose may surround it; only the LAST such block is parsed):

\`\`\`learning-os
{
  "version": 2,
  "sessionId": "<echo the Session id from this export header>",
  "reviews": [
    { "promptId": "<id from the DUE list above>", "grade": "good", "note": "optional" },
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
    { "topicTitle": "...", "keyInsight": "brief — 1-2 sentences, depth lives in Obsidian",
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
  "studiedTopics": ["<exact title of a topic genuinely studied this session>"],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: grade is one of again|hard|good|easy — the user's own recall verdict, never yours.
Quiz through the DUE cards listed in this export and reference them by promptId.
Prefer promptId reviews; use topicTitle-only reviews only for work outside any listed card.
applicationEvents: record only things the user genuinely did this session (solved a novel
problem, used it in a project) — one such event satisfies the topic's mastery application
condition, so do not fabricate them.
sourceEvidence: entries describe what the learner actually reconstructed, not the assistant's
summary. Curated sources include sourceId and have substitutionReason null. Replacements omit
sourceId and require a non-null substitutionReason. Expired curated sources require both
verifiedLiveAt and verificationNote after live verification; otherwise both fields are null.
noteSummaries: keep each entry BRIEF — Terrain is an index, not a note store. Put the full
conspect in the Obsidian note (write it as chat prose); keyInsight is a short pointer and
suggestedNoteRef names where the depth lives. Name any secondary artifact (a OneNote drawing)
inside the summary prose, not as a separate field.
studiedTopics: titles of topics genuinely studied this session — a planned topic listed here
is activated on import (its successors unblock). Do not list topics merely mentioned.
Omit arrays you have nothing for (use []). Do not add fields outside this schema — the parser
is strict and will reject the whole block. Keep each prompt atomic — one fact or concept per
prompt. promptKind: "code" = write an implementation from scratch; "problem" = a concrete
practice problem (include url + problemDifficulty + estimatedMinutes).`;
