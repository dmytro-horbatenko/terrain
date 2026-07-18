import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR } from './content-dir';
import { COURSE_MANIFEST } from './course-manifest';

describe('COURSE_MANIFEST', () => {
  it('lists every ordered Web3 content file', () => {
    const files = readdirSync(join(CONTENT_DIR, 'web3'))
      .filter((name) => /^\d\d[a-z]?-.*\.json$/.test(name))
      .sort()
      .map((name) => `web3/${name}`);

    expect(COURSE_MANIFEST.find(({ id }) => id === 'web3')?.files).toEqual(files);
  });
});
