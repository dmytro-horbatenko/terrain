import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFileSync(path.join(root, 'curriculum-map.json'), 'utf8'));
const expectedNode = readFileSync(path.join(root, '.node-version'), 'utf8').trim();
const failures = [];
if (process.versions.node !== expectedNode) {
  failures.push(`Use Node ${expectedNode} from .node-version (current: ${process.versions.node}).`);
}
const keys = new Set();
for (const entry of map.entries) {
  if (!entry.key || keys.has(entry.key)) failures.push('Each map entry needs a unique key.');
  keys.add(entry.key);
  if (!entry.topicTitle || !['existing', 'planned'].includes(entry.artifactState)) {
    failures.push(`Invalid topic or artifact state: ${entry.key}`);
  }
  if (!Array.isArray(entry.paths) || !entry.paths.length) {
    failures.push(`Missing artifact paths: ${entry.key}`);
    continue;
  }
  for (const file of entry.paths) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      failures.push(`Use repository-relative paths: ${entry.key}`);
    } else if (entry.artifactState === 'existing' && !existsSync(path.join(root, file))) {
      failures.push(`Missing existing artifact: ${file}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Workspace map: ${map.entries.length} entries checked; planned paths are not completion claims.`,
  );
}
