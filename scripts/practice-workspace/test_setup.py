"""Safety checks for the public guarded-write interface; no learner solutions."""
import importlib.util
from pathlib import Path
import tempfile
import json
import shutil
import subprocess
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("workspace_setup", Path(__file__).with_name("setup.py"))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class GuardedUpdatesTest(unittest.TestCase):
    def test_changed_file_rejects_the_whole_plan_before_any_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "first.txt").write_bytes(b"original")
            (root / "second.txt").write_bytes(b"new learner work")
            updates = [
                setup.Update("first.txt", b"original", b"updated"),
                setup.Update("second.txt", b"original", b"updated"),
            ]
            with self.assertRaises(setup.SetupError):
                setup.apply_updates(root, updates, write=True)
            self.assertEqual((root / "first.txt").read_bytes(), b"original")
            self.assertEqual((root / "second.txt").read_bytes(), b"new learner work")

    def test_preview_is_read_only_and_apply_preserves_unrelated_work(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "learner.txt").write_bytes(b"unfinished solution")
            updates = [setup.Update("docs/setup.md", None, b"instructions")]
            setup.apply_updates(root, updates)
            self.assertFalse((root / "docs").exists())
            setup.apply_updates(root, updates, write=True)
            self.assertEqual((root / "docs/setup.md").read_bytes(), b"instructions")
            self.assertEqual((root / "learner.txt").read_bytes(), b"unfinished solution")

    def test_symlink_parent_and_path_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            outside = Path(temp) / "outside"
            outside.mkdir()
            (root / "docs").symlink_to(outside, target_is_directory=True)
            for path in ["docs/setup.md", "../outside/setup.md"]:
                with self.subTest(path=path), self.assertRaises(setup.SetupError):
                    setup.apply_updates(root, [setup.Update(path, None, b"unexpected")], write=True)
            self.assertFalse((outside / "setup.md").exists())

    def test_failed_write_restores_files_already_updated(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "first.txt").write_bytes(b"learner original")
            updates = [
                setup.Update("first.txt", b"learner original", b"updated"),
                setup.Update("second.txt", None, b"new file"),
            ]
            replace = setup.os.replace

            def fail_second(source, target):
                if target.name == "second.txt":
                    raise PermissionError("simulated disk write failure")
                return replace(source, target)

            with patch.object(setup.os, "replace", side_effect=fail_second):
                with self.assertRaises(setup.SetupError):
                    setup.apply_updates(root, updates, write=True)
            self.assertEqual((root / "first.txt").read_bytes(), b"learner original")
            self.assertFalse((root / "second.txt").exists())
            self.assertFalse(list(root.glob(".terrain-setup-*")))


@unittest.skipUnless(shutil.which("node"), "Node is required for the installed map checker")
class WorkspaceMapTest(unittest.TestCase):
    def test_planned_path_is_allowed_but_missing_existing_artifact_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "scripts").mkdir()
            shutil.copy2(Path(__file__).parent / "templates/scripts/check-workspace.mjs", root / "scripts/check-workspace.mjs")
            version = subprocess.check_output(["node", "-p", "process.versions.node"], text=True)
            (root / ".node-version").write_text(version)
            entry = {"key": "future", "topicTitle": "Future topic", "artifactState": "planned", "paths": ["unwritten.ts"]}
            (root / "curriculum-map.json").write_text(json.dumps({"entries": [entry]}))
            command = ["node", "scripts/check-workspace.mjs"]
            planned = subprocess.run(command, cwd=root, capture_output=True, text=True)
            self.assertEqual(planned.returncode, 0, planned.stderr)
            entry["artifactState"] = "existing"
            (root / "curriculum-map.json").write_text(json.dumps({"entries": [entry]}))
            existing = subprocess.run(command, cwd=root, capture_output=True, text=True)
            self.assertNotEqual(existing.returncode, 0)
            self.assertIn("Missing existing artifact", existing.stderr)


if __name__ == "__main__":
    unittest.main()
