# Notes review and learning UX delivery plan

The accepted implementation is prepared locally. Production deployment and
interactive browser verification remain outstanding.

Design: [notes review and learning UX](../specs/2026-10-03-notes-review-and-learning-ux-design.md).
Operations: [topic-note-review](../../ops/topic-note-review.md).

## Delivered

| Slice | Result |
| --- | --- |
| Today and Roadmap | Current chapter/lesson; explicit started semantics and suggestion labels; focus retained through URL navigation |
| Versioned writing | Separate references, immutable text history, owner scoping, atomic revision/hash checks and stable review receipts |
| One-topic AI context | Latest full text via copy or read-only MCP; pending assessment payloads and unrelated notes excluded |
| Session completion | One paste previews learning and notes separately; explicit note acceptance; session/receipt recovery after lost responses |
| Provenance | Unknown legacy origins stay unknown; exact confirmed AI drafts may receive attribution without claiming review or study |

Existing manual editing, learning-os v2, curriculum order, prerequisites and
FSRS remain compatible. Notes can record a partial lesson without activating it.
Unstarted lessons and chapter containers are not bulk-filled as personal notes.

## Release checklist

- [x] Strict contract, owner/CAS/idempotence and rollback tests.
- [x] Parser, transport, account-scoped persistence and rendered conflict states.
- [x] Read-only context and Learn/Repeat export checks.
- [x] Additive schema validation, builds, lint and formatting.
- [x] Fresh code review; request-size and lost-response findings fixed.
- [ ] Full HTTP suites in an environment allowing local server sockets.
- [ ] Interactive desktop/mobile, keyboard and recovery smoke.
- [ ] Verified production backup; migration before new UI; matching API/web images.

Private archive cleanup/import is separate from this application delivery.
Generated topic material, learner exports and one-off scripts stay local.

## Follow-up UX priorities

1. Complete the release smoke and confirm the daily learn → record → review loop.
2. Observe use of the comparison/recovery screens before changing their layout.
3. Improve practice guidance at the authored curriculum’s relevant milestones;
   distinguish assisted practice from delayed independent transfer.

Do not add a mastery score based on note quantity or promise engineering skill
from completed reading. Progress indicators must remain tied to real evidence.
