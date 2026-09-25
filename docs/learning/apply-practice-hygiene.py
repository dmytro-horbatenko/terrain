#!/usr/bin/env python3
"""Apply the reviewed hygiene patch without embedding the old key in an artifact."""
import hashlib
from pathlib import Path
import re
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
patch = Path(__file__).with_name("practice-hygiene.patch").resolve()
expected = {'package.json': 'c2f30252dfe0eab27b4e46805bd459a73d72f34e05308f07f71172dc178f8c04', 'practice/01.hashing.ts': 'c2c6fc5a7952a53b3e8be3e14c6cd984a3955aef0906fadf9937022cfc0513c6', 'README.md': 'd7cf695769867357510142f41b0df56519cdff26a73f3a2f82421f9f3dc7937b', 'contracts/phase01/README.md': 'a13e32a49b4194a08622121c457393f37d931d86319544a015c4fd3792387091'}
for name, digest in expected.items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Stopped: {name} changed since inspection. Review the patch again; no files changed.")

source = root / "practice/01.hashing.ts"
pattern = r'const privateKeyHex\s*=\s*"0x[0-9a-fA-F]{64}" as Hex;'
if len(re.findall(pattern, source.read_text())) != 1:
    raise SystemExit("Stopped: expected one demonstration fixture; no files changed.")
subprocess.run(["git", "apply", "--check", "--unidiff-zero", str(patch)], cwd=root, check=True)
subprocess.run(["git", "apply", "--unidiff-zero", str(patch)], cwd=root, check=True)
updated, count = re.subn(
    pattern,
    '// Public demonstration fixture: scalar one. Never fund or reuse this account.\n'
    'const privateKeyHex = `0x${"1".padStart(64, "0")}` as Hex;',
    source.read_text(),
)
if count != 1:
    raise SystemExit("Patch applied but fixture replacement needs review; do not run the hashing exercise yet.")
source.write_text(updated)
print("Applied practice hygiene to the four reviewed files. Run yarn test in that repository.")
