export function StudyGuide() {
  return (
    <details className="card card-pad" id="study-guide">
      <summary className="card-title" style={{ cursor: 'pointer', margin: 0 }}>
        Your study routine
      </summary>
      <div className="col gap-3" style={{ marginTop: 16 }}>
        <p>
          Keep one primary topic and one project milestone active. The full curriculum is a
          long-term path; a session has one objective and a clear stopping point.
        </p>
        <div>
          <b>A two-hour session</b>
          <ol>
            <li>
              Use about 15 minutes for the selected review slice. Grade your first attempt honestly;
              the remaining backlog can wait.
            </li>
            <li>
              Spend about 90 minutes on one objective: understand a mechanism, derive it, build
              something, or diagnose a failure.
            </li>
            <li>
              Use the last 15 minutes to correct your note, link actual evidence, and save one next
              action.
            </li>
          </ol>
        </div>
        <div>
          <b>A starting weekly allocation</b>
          <p className="muted">
            6 hours deep study · 4 project work · 1½ retrieval · 1½ DSA or one foundation track · 1
            delayed practice and reflection · 1 notes. Adjust the 15-hour total to your capacity; a
            substantial new course replaces some of this time.
          </p>
        </div>
        <div>
          <b>Keep knowledge you can revisit</b>
          <p>
            Write your canonical explanation in the topic’s Personal notes. It is saved to your
            account for use across devices. Connect sources, diagrams and executable artifacts with
            links. Obsidian and other note tools are optional. The session summary is a separate,
            compact handoff.
          </p>
        </div>
        <div>
          <b>Check independence over time</b>
          <p>
            Use the existing delayed skill checks for a fresh diagnosis, adaptation, comparison or
            explanation. Agree whether documentation is allowed. Preserve the first attempt and
            record hints or generated code honestly. Do not rehearse the exact check just before
            taking it.
          </p>
        </div>
        <div>
          <b>Build architectural judgment</b>
          <p>
            Start with wallet → indexer → escrow, then the DeFi branch with its needed accounting
            and distribution concepts. Keep one product active. Reuse infrastructure, but own the
            mechanism being assessed.
          </p>
          <p>
            For a decision, record constraints, alternatives, the choice and its cost, and what
            change would invalidate it. Then test a changed requirement. To reuse project evidence
            in a topic, add an application event with the actual artifact and your contribution; a
            saved link alone does not establish mastery.
          </p>
        </div>
        <p className="faint">
          Once a week: what can you explain or change without help, what remains fragile, and what
          should the next session resolve? Completion counts and the review streak are supporting
          signals.
        </p>
      </div>
    </details>
  );
}
