"""Small synthetic fixtures only; never reads or packs the real private data."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("pack_local_data", Path(__file__).with_name("pack-local-data.py"))
assert SPEC and SPEC.loader
PACK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACK)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gto-bundle-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.names = set(PACK.REQUIRED_PATHS) | {
            "data/private/computed-fixture.part-001.tree.json",
            "data/private/computed-fixture.quick.json",
            "data/private/solver-audits/computed-fixture.audit.json",
        }
        for name in self.names:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"synthetic fixture for {name}\n".encode())

    def pack(self):
        return Path(PACK.pack_bundle(self.root)["bundle"])

    def rewrite(self, source, transform):
        destination = self.root / "modified.zip"
        with zipfile.ZipFile(source) as archive:
            entries = {item.filename: archive.read(item) for item in archive.infolist()}
        transform(entries)
        with zipfile.ZipFile(destination, "w") as archive:
            for name, content in entries.items():
                archive.writestr(name, content)
        return destination

    def test_round_trip_includes_exact_whitelist_without_extracting(self):
        for name in ("data/private/secret.json", ".runtime/source.txt", "data/private/research/other.pdf", "data/private/solver-audits/log.txt", "data/private/solver-audits/nested/hidden.json"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("not included")
        bundle = self.pack()
        with zipfile.ZipFile(bundle) as archive:
            self.assertEqual(set(archive.namelist()), self.names | {PACK.MANIFEST_PATH})
        self.assertTrue(bundle.parent.samefile(self.root / "data/private/exports"))
        result = PACK.verify_bundle(bundle)
        self.assertEqual(result["fileCount"], len(self.names))
        self.assertTrue(result["verified"])
        self.assertFalse((self.root / PACK.MANIFEST_PATH).exists())

    def test_missing_required_source_fails_without_publishing(self):
        (self.root / sorted(PACK.REQUIRED_PATHS)[0]).unlink()
        with self.assertRaises(PACK.BundleError):
            self.pack()
        self.assertEqual(list(self.root.rglob("*.zip")), [])

    def test_changed_content_is_rejected(self):
        name = sorted(self.names)[0]
        def change(entries):
            original = entries[name]
            entries[name] = bytes([original[0] ^ 1]) + original[1:]
        with self.assertRaisesRegex(PACK.BundleError, "SHA-256"):
            PACK.verify_bundle(self.rewrite(self.pack(), change))

    def test_missing_payload_is_rejected(self):
        name = sorted(self.names)[0]
        with self.assertRaisesRegex(PACK.BundleError, "missing or unlisted"):
            PACK.verify_bundle(self.rewrite(self.pack(), lambda entries: entries.pop(name)))

    def test_unlisted_payload_is_rejected(self):
        with self.assertRaisesRegex(PACK.BundleError, "missing or unlisted"):
            PACK.verify_bundle(self.rewrite(self.pack(), lambda entries: entries.update({"data/private/computed-extra.quick.json": b"{}"})))

    def test_required_file_cannot_be_omitted_from_manifest_and_payload(self):
        name = sorted(PACK.REQUIRED_PATHS)[0]
        def change(entries):
            entries.pop(name)
            manifest = json.loads(entries[PACK.MANIFEST_PATH])
            manifest["files"] = [row for row in manifest["files"] if row["path"] != name]
            manifest["fileCount"] = len(manifest["files"])
            manifest["totalBytes"] = sum(row["bytes"] for row in manifest["files"])
            entries[PACK.MANIFEST_PATH] = json.dumps(manifest).encode()
        with self.assertRaisesRegex(PACK.BundleError, "Missing required"):
            PACK.verify_bundle(self.rewrite(self.pack(), change))

    def test_unsafe_and_nonwhitelisted_paths_are_rejected(self):
        bundle = self.pack()
        for name in ("../outside.json", "data/private/../secret.json", "data\\private\\computed-x.quick.json", "C:/secret.json", "data/private/secret.json", "data/private/research/extra.pdf", ".runtime/source.txt", "data/private/solver-audits/CON.json", "data/private/solver-audits/com1.audit.json"):
            self.assertFalse(PACK.is_allowed_payload(name))
            with self.subTest(name=name), self.assertRaises(PACK.BundleError):
                PACK.verify_bundle(self.rewrite(bundle, lambda entries: entries.update({name: b"bad"})))

    def test_raw_backslash_zip_paths_are_rejected(self):
        bundle = self.pack()
        name = b"data/private/computed-fixture.quick.json"
        changed = self.root / "backslash.zip"
        changed.write_bytes(bundle.read_bytes().replace(name, name.replace(b"/", b"\\")))
        with self.assertRaisesRegex(PACK.BundleError, "whitelist"):
            PACK.verify_bundle(changed)

    def test_size_and_count_disagreement_are_rejected(self):
        bundle = self.pack()
        for field in ("bytes", "fileCount", "totalBytes"):
            def change(entries):
                manifest = json.loads(entries[PACK.MANIFEST_PATH])
                if field == "bytes":
                    manifest["files"][0][field] += 1
                    manifest["totalBytes"] += 1
                else:
                    manifest[field] += 1
                entries[PACK.MANIFEST_PATH] = json.dumps(manifest).encode()
            with self.subTest(field=field), self.assertRaises(PACK.BundleError):
                PACK.verify_bundle(self.rewrite(bundle, change))

    def test_duplicate_and_link_members_are_rejected(self):
        bundle = self.pack()
        name = "data/private/computed-fixture.quick.json"
        duplicate = self.root / "duplicate.zip"
        duplicate.write_bytes(bundle.read_bytes())
        with zipfile.ZipFile(duplicate, "a") as archive:
            with self.assertWarns(UserWarning):
                archive.writestr(name, b"duplicate")
        with self.assertRaisesRegex(PACK.BundleError, "Duplicate ZIP"):
            PACK.verify_bundle(duplicate)
        linked = self.root / "linked.zip"
        with zipfile.ZipFile(bundle) as source, zipfile.ZipFile(linked, "w") as target:
            for info in source.infolist():
                content = source.read(info)
                if info.filename == name:
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                target.writestr(info, content)
        with self.assertRaisesRegex(PACK.BundleError, "not a regular file"):
            PACK.verify_bundle(linked)

    def test_dos_directory_without_trailing_slash_is_rejected(self):
        bundle = self.pack()
        destination = self.root / "dos-directory.zip"
        with zipfile.ZipFile(bundle) as source, zipfile.ZipFile(destination, "w") as target:
            for info in source.infolist():
                content = source.read(info)
                if info.filename.endswith(".quick.json"):
                    info.create_system = 0
                    info.external_attr = 0x10
                target.writestr(info, content)
        with self.assertRaisesRegex(PACK.BundleError, "not a regular file"):
            PACK.verify_bundle(destination)

    def test_inventory_change_aborts_without_publishing(self):
        original = PACK.inventory
        count = 0
        def changed(root):
            nonlocal count
            count += 1
            result = original(root)
            if count > 1:
                result.pop(next(iter(result)))
            return result
        PACK.inventory = changed
        try:
            with self.assertRaisesRegex(PACK.BundleError, "changed during packing"):
                self.pack()
            self.assertEqual(list((self.root / "data/private/exports").iterdir()), [])
        finally:
            PACK.inventory = original

    def destination(self):
        destination = self.root / "new-computer"
        destination.mkdir()
        return destination

    def assert_payload_absent(self, destination):
        for name in self.names:
            self.assertFalse((destination / name).exists(), name)

    def test_restore_round_trip_is_repeatable_and_preserves_unselected_files(self):
        bundle = self.pack()
        destination = self.destination()
        unrelated = destination / "data/private/my-personal-notes.json"
        unrelated.parent.mkdir(parents=True)
        unrelated.write_text("keep this private file")
        result = PACK.restore_bundle(destination, bundle)
        self.assertEqual(result["state"], "complete")
        self.assertEqual(result["addedFiles"], len(self.names))
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())
        before = {}
        for name in self.names:
            target = destination / name
            self.assertEqual(target.read_bytes(), (self.root / name).read_bytes())
            before[name] = PACK.fingerprint(target.stat())
        repeated = PACK.restore_bundle(destination, bundle)
        self.assertEqual(repeated["state"], "unchanged")
        self.assertEqual(repeated["skippedIdenticalFiles"], len(self.names))
        self.assertEqual(before, {name: PACK.fingerprint((destination / name).stat()) for name in self.names})
        self.assertEqual(unrelated.read_text(), "keep this private file")
        self.assertTrue(PACK.verify_bundle(Path(result["backupBundle"]))["verified"])

    def test_generation_changes_before_publish_and_rollback_but_not_idempotent_restore(self):
        destination = self.destination()
        bundle = self.pack()
        original_publish = PACK.publish_file
        original_delete = PACK.delete_owned_file
        published_tokens, removed_tokens = [], []
        def inspect_publish(source, target):
            self.assertIsNotNone(PACK.read_lock(destination))
            token = (destination / PACK.RESTORE_GENERATION).read_bytes()
            self.assertRegex(token, rb"\A[0-9a-f]{32}\n\Z")
            published_tokens.append(token)
            original_publish(source, target)
        with patch.object(PACK, "publish_file", inspect_publish):
            result = PACK.restore_bundle(destination, bundle)
        generation = (destination / PACK.RESTORE_GENERATION).read_bytes()
        self.assertEqual(set(published_tokens), {generation})
        PACK.restore_bundle(destination, bundle)
        self.assertEqual((destination / PACK.RESTORE_GENERATION).read_bytes(), generation)
        def inspect_delete(root, target, entry):
            if target != root / PACK.RESTORE_LOCK:
                self.assertIsNotNone(PACK.read_lock(root))
                token = (root / PACK.RESTORE_GENERATION).read_bytes()
                self.assertNotEqual(token, generation)
                removed_tokens.append(token)
            return original_delete(root, target, entry)
        with patch.object(PACK, "delete_owned_file", inspect_delete):
            PACK.rollback_transaction(destination, result["transactionId"])
        after = (destination / PACK.RESTORE_GENERATION).read_bytes()
        self.assertEqual(set(removed_tokens), {after})
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_automatic_rollback_has_its_own_persistent_generation(self):
        destination = self.destination()
        original = PACK.publish_file
        publication_tokens = []
        def interrupted(source, target):
            publication_tokens.append((destination / PACK.RESTORE_GENERATION).read_bytes())
            original(source, target)
            raise OSError("force automatic rollback")
        with patch.object(PACK, "publish_file", interrupted), self.assertRaisesRegex(OSError, "automatic rollback"):
            PACK.restore_bundle(destination, self.pack())
        self.assert_payload_absent(destination)
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())
        self.assertNotEqual((destination / PACK.RESTORE_GENERATION).read_bytes(), publication_tokens[0])

    def test_generation_failure_prevents_publication_and_preserves_lock(self):
        destination = self.destination()
        bundle = self.pack()
        with patch.object(PACK, "advance_generation", side_effect=OSError("epoch unavailable")), self.assertRaisesRegex(OSError, "epoch unavailable"):
            PACK.restore_bundle(destination, bundle)
        self.assert_payload_absent(destination)
        self.assertIsNotNone(PACK.read_lock(destination))
        self.assertFalse((destination / PACK.RESTORE_GENERATION).exists())

    def test_dry_run_does_not_create_any_destination_files(self):
        destination = self.destination()
        result = PACK.restore_bundle(destination, self.pack(), dry_run=True)
        self.assertTrue(result["dryRun"])
        self.assertEqual(result["addFiles"], len(self.names))
        self.assertEqual(list(destination.iterdir()), [])

    def test_one_conflict_rejects_whole_batch_before_publication(self):
        destination = self.destination()
        name = sorted(self.names)[-1]
        target = destination / name
        target.parent.mkdir(parents=True)
        target.write_bytes(b"existing different version")
        with self.assertRaisesRegex(PACK.BundleError, "Restore conflicts"):
            PACK.restore_bundle(destination, self.pack())
        self.assertEqual(target.read_bytes(), b"existing different version")
        self.assertTrue(all(not (destination / item).exists() for item in self.names - {name}))
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_identical_existing_file_survives_explicit_rollback(self):
        destination = self.destination()
        existing = sorted(self.names)[0]
        target = destination / existing
        target.parent.mkdir(parents=True)
        target.write_bytes((self.root / existing).read_bytes())
        identity = PACK.file_identity(target.stat())
        result = PACK.restore_bundle(destination, self.pack())
        rolled_back = PACK.rollback_transaction(destination, result["transactionId"])
        self.assertEqual(rolled_back["state"], "rolled-back")
        self.assertEqual(PACK.file_identity(target.stat()), identity)
        self.assertTrue(all(not (destination / item).exists() for item in self.names - {existing}))
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_case_alias_is_rejected_on_every_platform(self):
        destination = self.destination()
        target = destination / "data/private/COMPUTED-FIXTURE.QUICK.JSON"
        target.parent.mkdir(parents=True)
        target.write_bytes((self.root / "data/private/computed-fixture.quick.json").read_bytes())
        with self.assertRaisesRegex(PACK.BundleError, "Case-insensitive"):
            PACK.restore_bundle(destination, self.pack())
        self.assertTrue(target.exists())

    def test_linked_destination_directory_is_rejected(self):
        destination = self.destination()
        outside = self.root / "outside-data"
        outside.mkdir()
        (destination / "data").mkdir()
        try:
            os.symlink(outside, destination / "data/private", target_is_directory=True)
        except OSError:
            if os.name != "nt":
                self.skipTest("Creating a directory symlink is unavailable on this host")
            junction = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(destination / "data/private"), str(outside)], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(junction.returncode, 0, junction.stderr)
        with self.assertRaises(PACK.BundleError):
            PACK.restore_bundle(destination, self.pack())
        self.assertEqual(list(outside.iterdir()), [])

    def test_failure_mid_publish_rolls_back_all_new_files(self):
        destination = self.destination()
        original = PACK.publish_file
        calls = 0
        def interrupted(source, target):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise OSError("synthetic disk error")
            original(source, target)
        with patch.object(PACK, "publish_file", interrupted), self.assertRaisesRegex(OSError, "synthetic disk"):
            PACK.restore_bundle(destination, self.pack())
        self.assert_payload_absent(destination)
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())
        journal = json.loads(next((destination / PACK.TRANSACTIONS).glob("*/journal.json")).read_text())
        self.assertEqual(journal["state"], "rolled-back")

    def test_interruption_after_link_before_journal_update_is_rolled_back(self):
        destination = self.destination()
        original = PACK.publish_file
        def interrupted(source, target):
            original(source, target)
            raise OSError("linked but not acknowledged")
        with patch.object(PACK, "publish_file", interrupted), self.assertRaises(OSError):
            PACK.restore_bundle(destination, self.pack())
        self.assert_payload_absent(destination)
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_changed_published_file_is_preserved_and_blocks_rollback(self):
        destination = self.destination()
        original = PACK.publish_file
        edited = []
        def interrupted(source, target):
            original(source, target)
            target.write_bytes(b"user's independent change")
            edited.append(target)
            raise OSError("interrupted after user edit")
        with patch.object(PACK, "publish_file", interrupted), self.assertRaisesRegex(PACK.BundleError, "rollback preserved"):
            PACK.restore_bundle(destination, self.pack())
        self.assertEqual(edited[0].read_bytes(), b"user's independent change")
        lock = PACK.read_lock(destination)
        self.assertIsNotNone(lock)
        # Safeguarding that edit makes the remaining rollback safe on a later run.
        safeguarded = destination / "my-preserved-edit.txt"
        edited[0].rename(safeguarded)
        with patch.object(PACK, "process_alive", return_value=False):
            result = PACK.rollback_transaction(destination, lock["transactionId"])
        self.assertEqual(result["state"], "rolled-back")
        self.assertEqual(safeguarded.read_bytes(), b"user's independent change")
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_same_bytes_with_replaced_file_identity_are_not_removed(self):
        destination = self.destination()
        original = PACK.publish_file
        published = []
        def interrupted(source, target):
            if published:
                first = published[0]
                replacement = first.with_suffix(".replacement")
                replacement.write_bytes(first.read_bytes())
                os.replace(replacement, first)
                raise OSError("user replaced first file")
            original(source, target)
            published.append(target)
        with patch.object(PACK, "publish_file", interrupted), self.assertRaisesRegex(PACK.BundleError, "rollback preserved"):
            PACK.restore_bundle(destination, self.pack())
        self.assertTrue(published[0].exists())
        self.assertTrue((destination / PACK.RESTORE_LOCK).exists())

    def test_exclusive_publish_preserves_file_appearing_after_preflight(self):
        destination = self.destination()
        original = PACK.publish_file
        concurrent = []
        def collision(source, target):
            target.write_bytes(b"concurrent user's file")
            concurrent.append(target)
            original(source, target)
        with patch.object(PACK, "publish_file", collision), self.assertRaises(FileExistsError):
            PACK.restore_bundle(destination, self.pack())
        self.assertEqual(concurrent[0].read_bytes(), b"concurrent user's file")
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_live_restore_lock_is_not_stolen(self):
        destination = self.destination()
        bundle = self.pack()
        result = PACK.restore_bundle(destination, bundle)
        transaction = destination / PACK.TRANSACTIONS / result["transactionId"]
        PACK.acquire_lock(destination, result["transactionId"], transaction)
        with self.assertRaisesRegex(PACK.BundleError, "restore lock"):
            PACK.restore_bundle(destination, bundle)
        self.assertEqual(PACK.read_lock(destination)["pid"], os.getpid())

    def test_hard_exit_is_recovered_from_pending_journal_on_next_restore(self):
        destination = self.destination()
        bundle = self.pack()
        script = """import importlib.util,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('bundle',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
original=m.publish_file
def crash(source,target):
    original(source,target)
    os._exit(23)
m.publish_file=crash
m.restore_bundle(Path(sys.argv[2]),Path(sys.argv[3]))
"""
        child = subprocess.run([sys.executable, "-c", script, str(Path(PACK.__file__).resolve()), str(destination), str(bundle)], capture_output=True, text=True)
        self.assertEqual(child.returncode, 23, child.stderr)
        old = PACK.read_lock(destination)["transactionId"]
        result = PACK.restore_bundle(destination, bundle)
        self.assertEqual(result["addedFiles"], len(self.names))
        old_journal = json.loads((destination / PACK.TRANSACTIONS / old / "journal.json").read_text())
        self.assertEqual(old_journal["state"], "rolled-back")
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_hard_exit_after_complete_does_not_undo_successful_restore(self):
        destination = self.destination()
        bundle = self.pack()
        script = """import importlib.util,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('bundle',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.release_lock=lambda *args: os._exit(24)
m.restore_bundle(Path(sys.argv[2]),Path(sys.argv[3]))
"""
        child = subprocess.run([sys.executable, "-c", script, str(Path(PACK.__file__).resolve()), str(destination), str(bundle)], capture_output=True, text=True)
        self.assertEqual(child.returncode, 24, child.stderr)
        before = {name: PACK.file_identity((destination / name).stat()) for name in self.names}
        result = PACK.restore_bundle(destination, bundle)
        self.assertEqual(result["state"], "unchanged")
        self.assertEqual(before, {name: PACK.file_identity((destination / name).stat()) for name in self.names})
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_two_processes_cannot_claim_the_same_dead_restore(self):
        destination = self.destination()
        result = PACK.restore_bundle(destination, self.pack())
        transaction = destination / PACK.TRANSACTIONS / result["transactionId"]
        # A known exited child supplies an actually dead PID on every platform.
        dead = subprocess.Popen([sys.executable, "-c", "pass"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        dead.communicate(timeout=10)
        stale = PACK.acquire_lock(destination, result["transactionId"], transaction)
        stale["pid"] = dead.pid
        PACK.write_journal(destination / PACK.RESTORE_LOCK, stale)
        ready, proceed = destination / "claim-ready", destination / "claim-proceed"
        before_journal = Path(result["journal"]).read_bytes()
        before_generation = (destination / PACK.RESTORE_GENERATION).read_bytes()
        script = """import importlib.util,os,sys,time
from contextlib import contextmanager
from pathlib import Path
spec=importlib.util.spec_from_file_location('bundle',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root=Path(sys.argv[2]); original=m.recovery_claim; rollback=m.rollback_files
@contextmanager
def paused_claim(root,transaction):
    with original(root,transaction):
        Path(sys.argv[4]).write_text('exclusive claim held')
        deadline=time.monotonic()+15
        while not Path(sys.argv[5]).exists():
            if time.monotonic()>deadline: raise RuntimeError('test release timed out')
            time.sleep(0.02)
        yield
def checked_rollback(root,path,journal):
    assert m.read_lock(root)['pid']==os.getpid(), 'stale lock was not adopted'
    return rollback(root,path,journal)
m.recovery_claim=paused_claim; m.rollback_files=checked_rollback
m.rollback_transaction(root,sys.argv[3])
"""
        child = subprocess.Popen([sys.executable, "-c", script, str(Path(PACK.__file__).resolve()), str(destination), result["transactionId"], str(ready), str(proceed)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 10
            while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(ready.exists(), "First recovery did not acquire its claim")
            # The first owner intentionally has not adopted the dead PID yet.
            # This must be rejected by kernel exclusion, not a live-PID check.
            self.assertEqual(PACK.read_lock(destination), stale)
            with self.assertRaisesRegex(PACK.BundleError, "Another recovery owns"):
                PACK.rollback_transaction(destination, result["transactionId"])
            self.assertEqual(PACK.read_lock(destination), stale)
            self.assertEqual(Path(result["journal"]).read_bytes(), before_journal)
            self.assertEqual((destination / PACK.RESTORE_GENERATION).read_bytes(), before_generation)
            self.assertTrue(all((destination / name).exists() for name in self.names))
        finally:
            proceed.write_text("release first claimant")
            try:
                _, errors = child.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                _, errors = child.communicate()
        self.assertEqual(child.returncode, 0, errors)
        self.assert_payload_absent(destination)
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())
        self.assertTrue((transaction / ".recovery-claim").is_file())
        self.assertEqual(json.loads(Path(result["journal"]).read_text())["state"], "rolled-back")

    def test_crashed_recovery_owner_releases_kernel_claim_and_can_be_recovered(self):
        destination = self.destination()
        bundle = self.pack()
        result = PACK.restore_bundle(destination, bundle)
        generation = (destination / PACK.RESTORE_GENERATION).read_bytes()
        script = """import importlib.util,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('bundle',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
original=m.delete_owned_file
def crash(root,target,entry):
    assert m.read_lock(root)['pid']==os.getpid()
    original(root,target,entry)
    os._exit(27)
m.delete_owned_file=crash
m.rollback_transaction(Path(sys.argv[2]),sys.argv[3])
"""
        child = subprocess.Popen([sys.executable, "-c", script, str(Path(PACK.__file__).resolve()), str(destination), result["transactionId"]], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        _, errors = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 27, errors)
        self.assertEqual(PACK.read_lock(destination)["pid"], child.pid)
        after_crash = (destination / PACK.RESTORE_GENERATION).read_bytes()
        self.assertNotEqual(after_crash, generation)
        claim = destination / PACK.TRANSACTIONS / result["transactionId"] / ".recovery-claim"
        claim_identity = PACK.file_identity(claim.stat())
        recovered = PACK.rollback_transaction(destination, result["transactionId"])
        self.assertEqual(recovered["state"], "rolled-back")
        self.assertNotEqual((destination / PACK.RESTORE_GENERATION).read_bytes(), after_crash)
        self.assertEqual(PACK.file_identity(claim.stat()), claim_identity)
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())
        self.assert_payload_absent(destination)

    def test_size_limits_fail_before_payload_staging(self):
        bundle = self.pack()
        for constant in ("MAX_BUNDLE_BYTES", "MAX_TOTAL_BYTES", "MAX_STRATEGY_BYTES", "MAX_CENTRAL_BYTES"):
            with self.subTest(constant=constant), patch.object(PACK, constant, 1), self.assertRaises(PACK.BundleError):
                PACK.verify_bundle(bundle)

    def test_changed_bundle_during_pinning_is_rejected(self):
        bundle = self.pack()
        original = PACK.os.fstat
        calls = 0
        def changed(descriptor):
            nonlocal calls
            value = original(descriptor)
            calls += 1
            if calls == 1:
                bundle.write_bytes(bundle.read_bytes() + b"mutated")
            return value
        with patch.object(PACK.os, "fstat", changed), self.assertRaisesRegex(PACK.BundleError, "Bundle (grew|changed)"):
            PACK.copy_pinned_bundle(bundle, self.root / "pinned.zip")

    def test_original_archive_change_after_pinning_does_not_replace_verified_snapshot(self):
        destination = self.destination()
        bundle = self.pack()
        original = PACK.copy_pinned_bundle
        def change_original(source, target):
            digest = original(source, target)
            source.write_bytes(b"not the copied archive anymore")
            return digest
        with patch.object(PACK, "copy_pinned_bundle", change_original):
            result = PACK.restore_bundle(destination, bundle)
        self.assertEqual(result["addedFiles"], len(self.names))
        for name in self.names:
            self.assertEqual((destination / name).read_bytes(), (self.root / name).read_bytes())

    def test_rollback_rejects_forged_paths_in_journal(self):
        destination = self.destination()
        result = PACK.restore_bundle(destination, self.pack())
        journal_path = Path(result["journal"])
        journal = json.loads(journal_path.read_text())
        journal["files"][0]["path"] = "../outside.txt"
        journal_path.write_text(json.dumps(journal))
        with self.assertRaisesRegex(PACK.BundleError, "Invalid restore journal"):
            PACK.rollback_transaction(destination, result["transactionId"])
        self.assertTrue(all((destination / name).exists() for name in self.names))

    def test_staged_payload_tampering_aborts_before_publication(self):
        destination = self.destination()
        original = PACK.plan_restore
        calls = 0
        def tamper(root, rows):
            nonlocal calls
            calls += 1
            if calls == 2:
                staged = next((root / PACK.TRANSACTIONS).glob("*/payload")) / rows[0]["path"]
                staged.write_bytes(b"changed after verification")
            return original(root, rows)
        with patch.object(PACK, "plan_restore", tamper), self.assertRaisesRegex(PACK.BundleError, "Staged payload changed"):
            PACK.restore_bundle(destination, self.pack())
        self.assert_payload_absent(destination)
        self.assertFalse((destination / PACK.RESTORE_LOCK).exists())

    def test_resource_limit_blocks_unusually_compressible_payload(self):
        bundle = self.pack()
        target = self.root / "expansion.zip"
        with zipfile.ZipFile(bundle) as original:
            values = {item.filename: original.read(item) for item in original.infolist()}
        name = "data/private/computed-fixture.quick.json"
        content = b"0" * (2 * 1024**2)
        values[name] = content
        manifest = json.loads(values[PACK.MANIFEST_PATH])
        for row in manifest["files"]:
            if row["path"] == name:
                row["bytes"] = len(content)
                row["sha256"] = PACK.hashlib.sha256(content).hexdigest()
        manifest["totalBytes"] = sum(row["bytes"] for row in manifest["files"])
        values[PACK.MANIFEST_PATH] = json.dumps(manifest).encode()
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, value in values.items():
                archive.writestr(path, value)
        with self.assertRaisesRegex(PACK.BundleError, "expansion-ratio"):
            PACK.verify_bundle(target)

    def test_unrecognized_lock_is_preserved_without_importing(self):
        destination = self.destination()
        lock = destination / PACK.RESTORE_LOCK
        lock.parent.mkdir(parents=True)
        lock.write_text("unrecognized or damaged lock")
        with self.assertRaisesRegex(PACK.BundleError, "Unrecognized restore lock"):
            PACK.restore_bundle(destination, self.pack())
        self.assertEqual(lock.read_text(), "unrecognized or damaged lock")
        self.assert_payload_absent(destination)


if __name__ == "__main__":
    unittest.main()
