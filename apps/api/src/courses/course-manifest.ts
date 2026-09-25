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
      'Build foundations in representation, complexity, invariants, correctness and recursion, then study algorithm families with curated problems and mixed transfer practice. Keep one topic active and use conceptual prerequisites to choose a useful next step.',
    files: [
      'dsa/00-foundations.json',
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
      'Comprehensive Ethereum, Solidity and DeFi study with focused builds and primary sources. Begin tools and application work early; learn security alongside the mechanisms it protects. Conceptual prerequisites preserve depth while allowing useful project work alongside the full roadmap.',
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
