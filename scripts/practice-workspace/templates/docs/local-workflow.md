# Two or more local study Macs

Use one private remote repository and one local clone per computer. The root
Terrain repository remains separate. Source files move through Git; installations
and build outputs are recreated locally. Personal notes and learning state stay
in Terrain rather than being copied into a second progress tracker here.

## One-time setup on another Mac

Clone the actual private repository URL with `git clone --recurse-submodules`.
Use Node from `.node-version` (24.2.0) and Foundry from `.foundry-version` (1.7.1).
These are the inspected baseline versions, not a claim of the latest releases.

Install the tools separately on every Mac. Apple Silicon uses native arm64 builds;
Intel uses x64/x86_64 builds. Open a native Terminal on Apple Silicon rather than a
Rosetta session. `uname -m` shows the shell architecture; `node -p process.arch`
shows the installed Node architecture. The version pins and repository are shared
even when the machines have different processors.

Use your existing Node version manager to select `.node-version`. For example,
with an already installed nvm, run `nvm install "$(cat .node-version)"`, then
`nvm use "$(cat .node-version)"`. With Foundry's installer already available, run
`foundryup --install "$(cat .foundry-version)"`. Then run:

```sh
corepack enable
git submodule update --init --recursive
yarn install --immutable
yarn check
```

Each Mac supplies its own local configuration. Recreate `node_modules`, compiler
caches and build outputs on that Mac; do not copy them between Intel and Apple
Silicon or synchronize the working directory through iCloud Drive. The lockfile
and submodule commit stay under version control; do not regenerate them merely
to switch devices. Compiler downloads and the first dependency installation
require network access. Run `yarn check` on each Mac before relying on its setup.

## Start a session

1. Check `git status` and the current branch. Save local work before switching branches.
2. Fetch remote changes, then `git pull --ff-only` on the same study branch.
3. Update submodules and install with `yarn install --immutable` if dependencies changed.
4. Open the current Terrain topic and its saved next action. Follow the artifact map.

Work on one active checkout at a time. A topic branch, for example
`study/evm-opcodes`, can travel across computers. Avoid permanent device-specific
branches. If histories diverge, inspect both changes and resolve them explicitly;
do not force-push or reset away the other computer's work.

## Stop or change computers

1. Run the relevant check and note its actual result; an unfinished exercise may fail.
2. Review the selected changed files and local/private values before staging them.
3. Commit a small checkpoint on the study branch and push it. A WIP commit is valid;
   describe the failing check and next action rather than claiming completion.
4. Confirm the push succeeded. Record the commit/file URL and one next action in Terrain.

A local commit alone is not available on another computer; push is the handoff.
Untracked files and unsaved editor buffers do not travel through Git. If offline,
commit locally and keep working on that device until you can push; record that the
other clone has not received the work. Merge into `main` when relevant checks pass.

## Connect an artifact to Terrain

Use the real HTTPS repository/file/commit URL in the topic's practice artifact or
existing project checkpoint. Record the executed command, observed result, scope
and assistance. A commit permalink preserves what was actually reviewed; a branch
link is convenient for continuing. Neither grants the tutor access automatically.
Supply the specific code or read-only repository access when requesting a review.

`curriculum-map.json` is navigation only. Add the actual Terrain topic URL/ID when
available; never invent UUIDs or infer completion from files. Keep cumulative
learner understanding, schedules and next actions in Terrain. Short README files
may explain how to run an artifact; preserve existing notes during any gradual move.

## Structure and scope

Keep current `practice/` exercises until an explicit move updates their imports,
map and commands. New TypeScript labs can use the course's `scripts/phase01/` paths;
Solidity uses `contracts/phaseNN/` and matching `test/phaseNN/`. Specialized work
stays under `security/`, `gas/`, and `defi/`. Create `projects/wallet-console/`, then
indexer and escrow only when that complementary milestone is selected. Do not
create solved future lessons or a new course order while organizing folders.

For a finished artifact, keep a concise design decision, a failure reproduction,
meaningful tests, and what remains unproved. Revisit a changed case independently
after a delay. This supports deep learning and defensible portfolio work; a green
pipeline or a collection of copied projects is not evidence of independence.
