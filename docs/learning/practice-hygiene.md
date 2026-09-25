# Practice checks and the prepared patch

Status on 25 September 2026: **prepared, not applied**. Filesystem permissions
blocked the first write in `/Users/dmitrijgorbatenko/personal/web3-practice`,
including the approved escalation. No files in that repository changed.

The [patch](practice-hygiene.patch) adds an address-equality assertion, removes
private-key/account-object logging, includes the existing TypeScript checks in
`yarn test`, and documents their actual scope. It preserves the learner's Merkle
and signature implementations and existing dependency changes. The already
installed `tsx` runner is used; no dependency or lockfile change is proposed.

The unknown original private-key literal is deliberately absent from the patch.
The [guarded applicator](apply-practice-hygiene.py) separately replaces that
literal with an explicitly public demonstration fixture without printing it.
Never fund or reuse demonstration accounts.

## Apply and verify

From a terminal with write access to the practice repository, run:

```bash
python3 /Users/dmitrijgorbatenko/personal/consistency/docs/learning/apply-practice-hygiene.py /Users/dmitrijgorbatenko/personal/web3-practice
yarn --cwd /Users/dmitrijgorbatenko/personal/web3-practice test
```

Use the applicator rather than applying the patch alone. It checks the four
inspected files before writing and stops if any has changed, protecting newer
work. In that case, review and regenerate the patch against the new files.
Do not bypass the check or reset the repository. No commit is made.

## What has been demonstrated

- The existing four-leaf Merkle proof for C passes, including its changed-value,
  sibling-direction and reordered-leaf checks.
- The existing signature exercise passes recovery, changed-message,
  raw-versus-EIP-191 and low-s checks.
- The proposed normal `yarn test` passed in a temporary copy: three TypeScript
  checks (address, Merkle, signature) and one Foundry scaffold test. This does not
  mean the patch is installed in the original repository.
- Foundry's current test is a trivial scaffold assertion. It checks the toolchain,
  not contract behavior or completion of a Solidity lesson.

General Merkle trees, proofs for every position, odd/empty input policies and
substantive Solidity tests remain learner work. Keep those limitations in the
related Terrain note until actual artifacts demonstrate them.
