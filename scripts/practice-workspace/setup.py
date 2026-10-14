#!/usr/bin/env python3
"""Prepare or apply the reviewed local-study workspace update without printing source."""
from collections import namedtuple
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


HERE = Path(__file__).resolve().parent
RECEIPT = ".terrain-workspace-setup.json"
EXPECTED = {
    "package.json": "c2f30252dfe0eab27b4e46805bd459a73d72f34e05308f07f71172dc178f8c04",
    "README.md": "d7cf695769867357510142f41b0df56519cdff26a73f3a2f82421f9f3dc7937b",
    "foundry.toml": "11ffd150a0b6d966052dbb9c5a7a604c595c6c147093bd1138f696f8bc95c03c",
    "hardhat.config.ts": "c2540e3a3207725e2290cc0e09f4f5b0eecf65224921164246ac0316361aec57",
    ".gitignore": "dd74ac89177c0eaa1038c4db208be023668df6d16640b9d870b66d562c379c7b",
    "tsconfig.json": "2c0829f2749e797a90f84e35fff4196f43938a64ee5e96bbf96591a351d02288",
    "contracts/phase01/README.md": "a13e32a49b4194a08622121c457393f37d931d86319544a015c4fd3792387091",
    "practice/01.hashing.ts": "c2c6fc5a7952a53b3e8be3e14c6cd984a3955aef0906fadf9937022cfc0513c6",
    "practice/02.merkle.ts": "b4e55f8cd498bce54935e07960dbdd17c49dbfc2507a4a9749ee1e3a0109cdd7",
    "practice/02.merkle.test.ts": "1d18bd07ee9e8a0c74e8608a3582f8abebe36f627a187aed0f65d6c2b1fbf971",
    "practice/sign-recover.ts": "24085a08992c40b20b90aebf11c143371b7a5fc2f09bf2a213ae3a758fde21bf",
}


class SetupError(Exception):
    pass


Update = namedtuple("Update", "path before after")


def checked_path(root, name):
    path = Path(name)
    if path.is_absolute() or ".." in path.parts:
        raise SetupError(f"Unsafe path: {name}")
    target = root
    for part in path.parts:
        target /= part
        if target.is_symlink():
            raise SetupError(f"Refusing symlink: {name}")
    return target


def apply_updates(root, updates, *, write=False):
    """Check the complete snapshot before writing; refuse concurrent or unrelated edits."""
    root = Path(root).resolve()
    for update in updates:
        target = checked_path(root, update.path)
        actual = target.read_bytes() if target.exists() else None
        if actual != update.before:
            raise SetupError(f"Changed since preparation: {update.path}; no files changed.")
    if not write:
        return
    changed = []
    try:
        for update in updates:
            target = checked_path(root, update.path)
            actual = target.read_bytes() if target.exists() else None
            if actual != update.before:
                raise SetupError(f"Concurrent edit: {update.path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(target, update.after)
            changed.append(update)
    except (OSError, SetupError):
        for update in reversed(changed):
            target = checked_path(root, update.path)
            if target.read_bytes() != update.after:
                raise SetupError(f"Concurrent edit during rollback: {update.path}; inspect workspace.")
            if update.before is None:
                target.unlink()
            else:
                atomic_write(target, update.before)
        raise SetupError("Update failed; written files rolled back. Inspect filesystem permissions.") from None


def atomic_write(target, content):
    mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
    name = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".terrain-setup-", delete=False) as temp:
            name = temp.name
            temp.write(content)
        os.chmod(name, mode)
        os.replace(name, target)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def replace_once(text, old, new, name):
    if text.count(old) != 1:
        raise SetupError(f"Expected edit no longer matches: {name}; no files changed.")
    return text.replace(old, new, 1)


def build_updates(root):
    originals = {}
    for name, digest in EXPECTED.items():
        target = checked_path(root, name)
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise SetupError(f"Review needed: {name} differs from inspected version; no files changed.")
        originals[name] = target.read_bytes()
    updated = {name: content.decode() for name, content in originals.items()}
    package = json.loads(updated["package.json"])
    package["engines"] = {"node": "24.2.0"}
    package["scripts"].update({
        "test": "yarn check:map && yarn test:practice && yarn test:forge",
        "test:practice": "node --test practice/01.hashing.ts practice/02.merkle.test.ts practice/sign-recover.ts",
        "typecheck": "tsc --noEmit",
        "check:map": "node scripts/check-workspace.mjs",
        "check": "yarn typecheck && yarn test && yarn build",
    })
    updated["package.json"] = json.dumps(package, indent=2) + "\n"
    source = updated["practice/01.hashing.ts"]
    pattern = r'const privateKeyHex\s*=\s*"0x[0-9a-fA-F]{64}" as Hex;'
    source, count = re.subn(pattern,
        '// Public demonstration fixture: scalar one. Never fund or reuse this account.\n'
        'const privateKeyHex = `0x${"1".padStart(64, "0")}` as Hex;', source)
    if count != 1:
        raise SetupError("Demonstration fixture needs review; no files changed.")
    source = 'import assert from "node:assert/strict";\n' + source
    for line in ['console.log({ privateKey });\n', 'console.log({ privateKeyStr: bytesToHex(privateKey) });\n']:
        source = replace_once(source, line, "", "practice/01.hashing.ts")
    source = replace_once(source,
        'const address2 = privateKeyToAccount(privateKeyHex);\nconsole.log({ address2 });',
        'const viemAddress = privateKeyToAccount(privateKeyHex).address;\n'
        'assert.equal(address.toLowerCase(), viemAddress.toLowerCase());\nconsole.log({ viemAddress });',
        "practice/01.hashing.ts")
    updated["practice/01.hashing.ts"] = source
    updated["practice/02.merkle.test.ts"] = replace_once(updated["practice/02.merkle.test.ts"],
        'from "./02.merkle.js"', 'from "./02.merkle.ts"', "practice/02.merkle.test.ts")
    config = json.loads(updated["tsconfig.json"])
    config["compilerOptions"].update({"noEmit": True, "allowImportingTsExtensions": True})
    config["include"] = list(dict.fromkeys(config["include"] + ["scripts/**/*.ts"]))
    updated["tsconfig.json"] = json.dumps(config, indent=2) + "\n"
    updated["foundry.toml"] = replace_once(updated["foundry.toml"],
        '# Auto-detect the newest solc matching each file\'s pragma (so both `^0.8.x` and\n'
        '# exact-pinned course code compile without friction); newest release is 0.8.35.\n'
        'auto_detect_solc = true',
        '# Match Hardhat and other study computers. Older tutorial compilers need an explicit profile.\n'
        'solc = "0.8.35"\nauto_detect_solc = false\n'
        '# Shared lab baseline; fork-specific exercises must select their intended fork.\n'
        'evm_version = "osaka"', "foundry.toml")
    updated["hardhat.config.ts"] = replace_once(updated["hardhat.config.ts"],
        "settings: { optimizer: { enabled: true, runs: 200 } }",
        "settings: { evmVersion: 'osaka', optimizer: { enabled: true, runs: 200 } }",
        "hardhat.config.ts")
    updated["hardhat.config.ts"] = replace_once(updated["hardhat.config.ts"],
        '// tree and remappings are defined ONCE and compile identically under both toolchains.',
        '// tree and remappings are shared. Compiler, EVM target and optimizer are pinned\n'
        '// explicitly in both configs; this does not guarantee identical metadata/bytecode.',
        "hardhat.config.ts")
    updated[".gitignore"] += "\n# Per-machine local values and editor/build state\n.env.*\n!.env.example\n*.tsbuildinfo\n"
    updated["README.md"] = replace_once(updated["README.md"],
        'forge test               # Foundry (primary test runner)',
        'yarn test                # Map, existing TS checks, then Foundry', "README.md")
    updated["README.md"] = updated["README.md"].replace(
        '- **Solidity**: Foundry auto-detects the newest compatible compiler per file (newest release **0.8.35**); Hardhat pins **0.8.35**.',
        '- **Solidity**: both Foundry and Hardhat pin **0.8.35**.')
    updated["README.md"] = updated["README.md"].replace('## Versions (kept current, verified against registries)',
        '## Reproducible baseline (not a claim of newest releases)')
    updated["README.md"] = updated["README.md"].replace('1 — Fundamentals (mostly notes)',
        '1 — Earlier artifact notes; canonical personal notes live in Terrain')
    updated["README.md"] += "\n" + (HERE / "templates/README-addition.md").read_text()
    updated["contracts/phase01/README.md"] = replace_once(updated["contracts/phase01/README.md"],
        '`practice/01.hashing.ts` — implements private key generation, EC-derived public\n'
        'key (`@noble/secp256k1`), manual keccak256 address derivation (`viem`), and\n'
        'cross-checks the result against `viem/accounts`\' `privateKeyToAccount`. Match\nconfirmed.',
        '`practice/01.hashing.ts` — uses a public demonstration fixture and checks manual\n'
        'address derivation against viem. Run `yarn test:practice`. This checks one\n'
        'fixture; it does not demonstrate every SEC1 form or a complete wallet.',
        'contracts/phase01/README.md')
    updates = [Update(name, originals[name], value.encode()) for name, value in updated.items()
               if value.encode() != originals[name]]
    for name in [".node-version", ".foundry-version", ".gitattributes", "curriculum-map.json",
                 "scripts/check-workspace.mjs", ".github/workflows/checks.yml", "docs/local-workflow.md"]:
        target = checked_path(root, name)
        if target.exists():
            raise SetupError(f"New file already exists: {name}; review before applying, no files changed.")
        updates.append(Update(name, None, (HERE / "templates" / name).read_bytes()))
    receipt = {"version": 1, "files": {u.path: hashlib.sha256(u.after).hexdigest() for u in updates}}
    updates.append(Update(RECEIPT, None, (json.dumps(receipt, indent=2) + "\n").encode()))
    return updates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--apply", action="store_true", help="Write the reviewed update after all guards pass")
    args = parser.parse_args()
    root = args.target.resolve()
    try:
        receipt = checked_path(root, RECEIPT)
        if receipt.exists():
            saved = json.loads(receipt.read_text())
            if saved.get("version") != 1:
                raise SetupError("Unknown workspace setup receipt; no files changed.")
            changed = [name for name, digest in saved["files"].items()
                       if not checked_path(root, name).is_file()
                       or hashlib.sha256(checked_path(root, name).read_bytes()).hexdigest() != digest]
            print(json.dumps({"status": "already installed", "laterEditsPreserved": changed}, indent=2))
            return
        updates = build_updates(root)
        apply_updates(root, updates, write=args.apply)
        print(json.dumps({"status": "applied" if args.apply else "preview only",
                          "files": [u.path for u in updates],
                          "next": "Run yarn check in the practice repository; no commits or push performed."}, indent=2))
    except (SetupError, OSError, ValueError) as error:
        # Never emit source text, patch context, or captured private literals.
        if isinstance(error, SetupError):
            parser.exit(1, str(error) + "\n")
        parser.exit(1, "Workspace setup could not read or update the expected files; no source printed.\n")


if __name__ == "__main__":
    main()
