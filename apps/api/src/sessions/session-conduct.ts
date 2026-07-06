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
4. On any card I grade again or hard, before moving on make me explain the
   correct reasoning back in my own words — why it works, not just the answer.
   Push on gaps; a fluent-sounding restatement that skips the mechanism doesn't
   count.
5. Cards tagged [NEW] have never been studied: give a 2-4 sentence introduction
   first, then quiz as normal.
6. If a due topic is application-worthy (a pattern/technique) and has no
   application event yet, offer me one concrete novel problem to solve. If I
   genuinely solve it, record it in applicationEvents (see the output contract).
Reference every review by promptId from the queue above.`;

export const LEARN_CONDUCT = `## SESSION CONDUCT — learning
Teach me the topic in LEARNING GOAL, then make me prove I learned it. Do not
just lecture — the session must force retrieval, elaboration, and application.
1. Teach Socratically — questions before explanations. Push back if I move too
   fast; enforce confusion time. Connect new material to the prerequisites above.
2. ELABORATE — before you consider the topic taught, make me explain it back
   in my own words: why it works, its invariant, and where it breaks. Probe
   gaps; don't accept a fluent restatement that skips the mechanism.
3. DO — make me actually apply it: implement it from scratch, or solve a novel
   variant that fits the topic type. Check my work. If I genuinely solve a novel
   problem, record it in applicationEvents (see the output contract) so it counts
   toward mastery.
4. CONSPECT — at the end, write me an Obsidian-ready conspect of the topic as
   prose in the chat (not inside the learning-os block) for me to paste into my
   notes; if a diagram would help, describe the OneNote drawing to make.
5. In the learning-os block:
   - propose 3-7 atomic cards via proposedPrompts (mix concept/code/problem as
     fits the topic; don't duplicate the existing cards listed above);
   - write ONE brief noteSummaries entry that points at where the depth lives —
     keyInsight is a 1-2 sentence index (the full conspect is in Obsidian), and
     suggestedNoteRef names the primary Obsidian location;
   - if I solved a novel problem, add an applicationEvents entry;
   - list the topic's title in studiedTopics so the app activates it.
   Only add other titles to studiedTopics if we genuinely studied them in
   depth — never topics merely mentioned.`;
