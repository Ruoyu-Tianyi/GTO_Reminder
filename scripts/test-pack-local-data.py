"""Small synthetic fixtures only; never reads or packs the real private data."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
