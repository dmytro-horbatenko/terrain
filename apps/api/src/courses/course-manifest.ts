export interface CourseManifestEntry {
  id: string;
  domain: string;
  title: string;
  description: string;
  files: string[];
}

export const COURSE_MANIFEST: CourseManifestEntry[] = [
  {
    id: 'dsa',
    domain: 'DSA',
    title: 'Data Structures & Algorithms',
    description:
      'Root of the DSA learning path. Structure: NeetCode roadmap category order, each split into reviewable sub-patterns (the actual scheduling unit), each with curated problems from NeetCode 150 / Blind 75. Prereq edges follow real conceptual dependency, not just roadmap position. Study one sub-pattern at a time; drill into individual problems only when reviewing that sub-pattern.',
    files: [
      'dsa/01-arrays-hashing.json',
      'dsa/02-two-pointers.json',
      'dsa/03-sliding-window.json',
      'dsa/04-stack.json',
      'dsa/05-binary-search.json',
      'dsa/06-linked-list.json',
      'dsa/07-trees.json',
      'dsa/08-tries.json',
      'dsa/09-heap-priority-queue.json',
      'dsa/10-graphs.json',
      'dsa/11-backtracking.json',
      'dsa/12-advanced-graphs.json',
      'dsa/13-1d-dynamic-programming.json',
      'dsa/14-2d-dynamic-programming.json',
      'dsa/15-greedy.json',
      'dsa/16-intervals.json',
      'dsa/17-math-geometry.json',
      'dsa/18-bit-manipulation.json',
    ],
  },
  {
    id: 'web3',
    domain: 'Web3',
    title: 'Web3 / Solidity / DeFi',
    description:
      'Root of the Web3 learning path: fundamentals → Solidity → tooling → standards → gas → security → DeFi → EVM internals → frontier → full-stack. Code-first — every leaf has a Build task in the web3-practice repo and a Done-when gate; security threads from Phase 4 and is exhaustive in Phase 6. Study one leaf at a time.',
    files: [
      'web3/00-root.json',
      'web3/01a-core-ethereum.json',
      'web3/01b-consensus-scaling-aa.json',
      'web3/02a-solidity.json',
      'web3/02b-solidity.json',
      'web3/03a-foundry-core-testing.json',
      'web3/03b-foundry-ops-config.json',
      'web3/03c-hardhat.json',
      'web3/04a-standards.json',
      'web3/04b-standards.json',
      'web3/05a-storage-calldata-control-flow.json',
      'web3/05b-types-assembly-architecture.json',
      'web3/06a-security-methodology.json',
      'web3/06b-attacks.json',
      'web3/06c-external-crypto-mev.json',
      'web3/06d-proxy-dos-business.json',
      'web3/06e-wargames.json',
      'web3/07a-defi.json',
      'web3/07b-defi.json',
      'web3/08a-opcodes-yul-huff.json',
      'web3/08b-dispatch-storage-proxies-verification.json',
      'web3/09a-mev-intents-hooks.json',
      'web3/09b-restaking-rwa-zk-l2.json',
      'web3/10-fullstack.json',
    ],
  },
];
