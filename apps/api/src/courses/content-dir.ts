import { resolve } from 'path';

// process.cwd() is the workspace package directory (apps/api) in every
// context this runs in: `yarn workspace @terrain/api start` (dev),
// `yarn workspace @terrain/api test` (jest), and the prod Docker image
// (WORKDIR /workspace/apps/api). __dirname is NOT safe here — it points at
// apps/api/dist/src/courses when compiled but apps/api/src/courses under
// ts-jest, two different nesting depths from the repo root.
export const CONTENT_DIR = process.env.CONTENT_DIR ?? resolve(process.cwd(), '..', '..', 'content');
