export const OUTPUT_CONTRACT = `## OUTPUT CONTRACT — return exactly one fenced block

When the session ends, output ONE fenced code block tagged \`learning-os\` containing this JSON
(prose may surround it; only this block is parsed):

\`\`\`learning-os
{
  "version": 1,
  "sessionId": "<echo the Session id from this export header>",
  "reviews": [
    { "topicTitle": "<exact title>", "topicId": null, "quality": 0, "note": "optional" }
  ],
  "proposedTopics": [
    { "title": "...", "type": "pattern", "domain": "DSA", "description": "...",
      "prerequisiteTitles": [], "parentTitle": null, "aiContext": "why proposed" }
  ],
  "proposedPrompts": [
    { "topicTitle": "<exact title, existing or one from proposedTopics above>",
      "promptText": "...", "answerHint": "optional", "promptKind": "concept" }
  ],
  "noteSummaries": [
    { "topicTitle": "...", "keyInsight": "...", "invariant": "...",
      "contradiction": "...", "suggestedNoteRef": "..." }
  ],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: quality is 0–5. Reference topics by their exact title. Omit arrays you have nothing for
(use []). Do not add fields outside this schema. Keep each prompt in proposedPrompts atomic —
one fact or concept per prompt; split compound questions into separate prompts rather than
combining them. Set promptKind to "code" when the prompt asks for an algorithm/implementation
to be written out; use "concept" (or omit it) for definitional/conceptual questions.`;
