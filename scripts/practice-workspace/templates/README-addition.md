## Study workspace and switching computers

Use [the local workflow](docs/local-workflow.md) on each computer. This repository
contains runnable artifacts, tests and engineering decisions. Terrain keeps the
complete course, personal topic notes, recall, independent checks and the next step.

[`curriculum-map.json`](curriculum-map.json) maps exact topic titles to existing
files. An `authoredPath` is the course's suggested destination, not a second copy
to create. Existing `practice/` files stay in place. `planned` entries do not imply
that an exercise was started or completed. Add folders when you start their work.

The baseline is Node **24.2.0**, Yarn **4.17.0**, Foundry **1.7.1**, Solidity
**0.8.35** and the committed lockfile/submodule revision. These are the inspected
versions, not a claim that each is the latest release. Upgrade deliberately across
computers and CI together. TypeScript practice uses Node's native type stripping;
`yarn typecheck` separately checks types. No implicit transitive `tsx` is needed.

`yarn check` checks types, the map, the existing TypeScript assertions, Foundry,
and Hardhat compilation. CI uses the same command after an immutable install.

### What the current checks demonstrate

- Address derivation: one public fixture matches viem; no complete SEC1/boundary suite.
- Merkle: the existing four-leaf proof for C and its negative checks; no general tree proof.
- Signatures: existing recovery, mutation, prefix and low-s checks; no complete wallet.
- Foundry: the current scaffold checks trivial arithmetic, not contract behavior.
- Planned exercises remain learner work. A green run never establishes mastery.

Keep one primary topic and optionally one product milestone active. Preserve the
full authored course; projects complement deep study. Portfolio evidence should
show reproducible checks, reasoning, failure cases and a defense under a changed
requirement. It is evidence of particular skills, not a job or salary guarantee.
