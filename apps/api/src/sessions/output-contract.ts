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
    { "topicTitle": "...", "keyInsight": "...", "invariant": "...",
      "contradiction": "...", "suggestedNoteRef": "..." }
  ],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: grade is one of again|hard|good|easy — the user's own recall verdict, never yours.
Quiz through the DUE cards listed in this export and reference them by promptId.
Prefer promptId reviews; use topicTitle-only reviews only for work outside any listed card.
Omit arrays you have nothing for (use []). Do not add fields outside this schema — the parser
is strict and will reject the whole block. Keep each prompt atomic — one fact or concept per
prompt. promptKind: "code" = write an implementation from scratch; "problem" = a concrete
practice problem (include url + problemDifficulty + estimatedMinutes).`;
