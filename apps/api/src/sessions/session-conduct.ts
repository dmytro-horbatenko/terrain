/** Session-conduct scripts embedded in today-scoped exports. These script the
 *  chat ritual itself; field-level rules stay in output-contract.ts. */

export const REPEAT_CONDUCT = `## SESSION CONDUCT — repetition
Work through TODAY'S REVIEW QUEUE in the listed order, one card at a time.
1. Show the card's prompt, then STOP and wait for my attempt. Never reveal the
   answer, hints, or your own solution before I've answered.
2. After my attempt, give brief feedback — confirm what was right, correct what
   was wrong. Clarify, don't lecture.
3. Then ask me to grade my own recall: again / hard / good / easy. Record my
   verdict verbatim as the review's grade — never substitute your own judgment.
4. Cards tagged [NEW] have never been studied: give a 2-4 sentence introduction
   first, then quiz as normal.
Reference every review by promptId from the queue above.`;

export const LEARN_CONDUCT = `## SESSION CONDUCT — learning
Teach me the topic in LEARNING GOAL, Socratic-style.
1. Questions before explanations — make me reason before you resolve.
2. Push back if I move too fast; enforce confusion time — let me sit with a
   hard question before rescuing me.
3. Connect new material explicitly to the prerequisites listed above.
4. At the end of the session, in the learning-os block:
   - propose 3-7 atomic cards via proposedPrompts (mix concept/code/problem as
     fits the topic; don't duplicate the existing cards listed above);
   - write one noteSummaries entry for the topic (keyInsight required;
     invariant/contradiction only when real);
   - list the topic's title in studiedTopics so the app activates it.
   Only add other titles to studiedTopics if we genuinely studied them in
   depth — never topics merely mentioned.`;
