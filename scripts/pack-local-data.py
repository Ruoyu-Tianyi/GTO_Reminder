#!/usr/bin/env python3
"""Pack the project's selected private data; verify archives without extracting.

Only Python's standard library is used. Archive paths are relative to the project
root, so a verified archive can be manually extracted there on another computer.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import uuid
import zipfile


PRIVATE = "data/private"
RESEARCH_FILES = (
    "derived-chart-ranges.json",
    "derived-response-ranges.json",
    "derived-rangeconverter-6max-later.json",
    "derived-rangeconverter-9max-later.json",
    "derived-pokercoaching-ranges.json",
    "rangeconverter-6max-100bb.pdf",
    "rangeconverter-9max-100bb.pdf",
    "pokercoaching-ultimate-cash.pdf",
)
REQUIRED_PATHS = frozenset(f"{PRIVATE}/research/{name}" for name in RESEARCH_FILES)
MANIFEST_PATH = f"{PRIVATE}/exports/bundle-manifest.json"
BUNDLE_KIND = "gto-reminder-local-data-bundle"
COMPUTED_NAME = re.compile(r"computed-[A-Za-z0-9][A-Za-z0-9._-]*\.(?:tree|quick)\.json\Z")
AUDIT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.json\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
WINDOWS_DEVICE = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\Z", re.IGNORECASE)
CHUNK_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_FILES = 10000


class BundleError(ValueError):
    """An incomplete, unsafe, or inconsistent data bundle."""


def is_allowed_payload(name: str) -> bool:
    if not isinstance(name, str) or "\\" in name or ":" in name or "\x00" in name:
        return False
    path = PurePosixPath(name)
    if path.is_absolute() or path.as_posix() != name or any(part in (".", "..") for part in path.parts):
        return False
    if any(WINDOWS_DEVICE.fullmatch(part.split(".", 1)[0]) for part in path.parts):
        return False
    if name in REQUIRED_PATHS:
        return True
    if path.parent.as_posix() == PRIVATE:
        return COMPUTED_NAME.fullmatch(path.name) is not None
    return path.parent.as_posix() == f"{PRIVATE}/solver-audits" and AUDIT_NAME.fullmatch(path.name) is not None


def checked_stat(root: Path, path: Path, *, directory: bool = False) -> os.stat_result:
    """Reject links/reparse points, including any directory inside the root."""
    try:
        path.relative_to(root)
        current = path
        while current != root:
            item = current.lstat()
            if stat.S_ISLNK(item.st_mode) or getattr(item, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise BundleError(f"Links and reparse points are not included: {current}")
            if current != path and not stat.S_ISDIR(item.st_mode):
                raise BundleError(f"Expected a directory: {current}")
            current = current.parent
        result = path.lstat()
    except (OSError, ValueError) as error:
        if isinstance(error, BundleError):
            raise
        raise BundleError(f"Cannot read selected path {path}: {error}") from error
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected_type(result.st_mode):
        raise BundleError(f"Expected a {'directory' if directory else 'regular file'}: {path}")
    return result


def fingerprint(info: os.stat_result) -> tuple[int, int, int, int, int]:
    # Windows stat/fstat may report different ctime values immediately after a
    # file is created; birth time is stable there. Content changes use mtime.
    identity_time = getattr(info, "st_birthtime_ns", info.st_ctime_ns) if os.name == "nt" else info.st_ctime_ns
    return (info.st_size, info.st_mtime_ns, identity_time, info.st_dev, info.st_ino)


def require_complete_selection(names: set[str]) -> None:
    missing = sorted(REQUIRED_PATHS - names)
    if missing:
        raise BundleError(f"Missing required reference files: {', '.join(missing)}")
    for suffix in (".tree.json", ".quick.json"):
        if not any(PurePosixPath(name).parent.as_posix() == PRIVATE and name.endswith(suffix) for name in names):
            raise BundleError(f"No computed {suffix} file was selected")
    if not any(name.startswith(f"{PRIVATE}/solver-audits/") for name in names):
        raise BundleError("No solver audit JSON was selected")
    if len(names) > MAX_FILES:
        raise BundleError(f"The bundle exceeds the {MAX_FILES}-file limit")


def inventory(root: Path) -> dict[str, tuple[int, int, int, int, int]]:
    private = root / PRIVATE
    research = private / "research"
    audits = private / "solver-audits"
    for directory in (private, research, audits):
        checked_stat(root, directory, directory=True)
    candidates = [research / name for name in RESEARCH_FILES]
    candidates += [path for path in private.iterdir() if COMPUTED_NAME.fullmatch(path.name)]
    candidates += [path for path in audits.iterdir() if AUDIT_NAME.fullmatch(path.name)]
    selected = {path.relative_to(root).as_posix(): fingerprint(checked_stat(root, path)) for path in candidates}
    require_complete_selection(set(selected))
    if len({name.casefold() for name in selected}) != len(selected):
        raise BundleError("Selected paths collide on a case-insensitive filesystem")
    return dict(sorted(selected.items()))


def read_manifest(archive: zipfile.ZipFile, members: dict[str, zipfile.ZipInfo]) -> dict:
    info = members.get(MANIFEST_PATH)
    if info is None or info.file_size > MAX_MANIFEST_BYTES:
        raise BundleError("Missing or oversized bundle manifest")
    try:
        manifest = json.loads(archive.read(info))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BundleError(f"Invalid manifest JSON: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("kind") != BUNDLE_KIND:
        raise BundleError("Unsupported bundle manifest")
    created_at = manifest.get("createdAt")
    if not isinstance(created_at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", created_at):
        raise BundleError("Invalid manifest creation time")
    try:
        datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise BundleError("Invalid manifest creation time") from error
    return manifest


def verify_bundle(bundle_path: Path) -> dict:
    """Read and hash each selected member. Never extract or overwrite files."""
    try:
        with zipfile.ZipFile(bundle_path, "r") as archive:
            infos = archive.infolist()
            if len(infos) > MAX_FILES + 1:
                raise BundleError("Too many ZIP entries")
            members: dict[str, zipfile.ZipInfo] = {}
            seen_casefold: set[str] = set()
            for info in infos:
                name = info.filename
                if name in members or name.casefold() in seen_casefold:
                    raise BundleError(f"Duplicate ZIP path: {name}")
                if info.orig_filename != name or (name != MANIFEST_PATH and not is_allowed_payload(name)):
                    raise BundleError(f"ZIP path is outside the data whitelist: {name}")
                mode = info.external_attr >> 16
                if info.is_dir() or info.external_attr & 0x10 or (stat.S_IFMT(mode) and not stat.S_ISREG(mode)):
                    raise BundleError(f"ZIP member is not a regular file: {name}")
                if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise BundleError(f"Unsupported ZIP encoding: {name}")
                members[name] = info
                seen_casefold.add(name.casefold())
            manifest = read_manifest(archive, members)
            rows = manifest.get("files")
            if not isinstance(rows, list) or not rows or len(rows) > MAX_FILES:
                raise BundleError("Invalid manifest file list")
            entries: dict[str, dict] = {}
            for row in rows:
                if not isinstance(row, dict) or set(row) != {"path", "sha256", "bytes"}:
                    raise BundleError("Invalid manifest file entry")
                name, size, digest = row["path"], row["bytes"], row["sha256"]
                if not is_allowed_payload(name) or name in entries:
                    raise BundleError(f"Invalid or duplicate manifest path: {name}")
                if type(size) is not int or size < 0 or not isinstance(digest, str) or not SHA256.fullmatch(digest):
                    raise BundleError(f"Invalid size or SHA-256 for {name}")
                entries[name] = row
            payload_names = set(members) - {MANIFEST_PATH}
            if set(entries) != payload_names:
                raise BundleError("ZIP payload and manifest differ: missing or unlisted entries")
            require_complete_selection(payload_names)
            total_bytes = sum(row["bytes"] for row in rows)
            if type(manifest.get("fileCount")) is not int or manifest["fileCount"] != len(entries):
                raise BundleError("Manifest file count does not match its file list")
            if type(manifest.get("totalBytes")) is not int or manifest["totalBytes"] != total_bytes:
                raise BundleError("Manifest byte total does not match its file list")
            for name, row in entries.items():
                if members[name].file_size != row["bytes"]:
                    raise BundleError(f"Size mismatch: {name}")
                digest = hashlib.sha256()
                read_bytes = 0
                with archive.open(members[name]) as source:
                    for chunk in iter(lambda: source.read(CHUNK_BYTES), b""):
                        digest.update(chunk)
                        read_bytes += len(chunk)
                if read_bytes != row["bytes"] or digest.hexdigest() != row["sha256"]:
                    raise BundleError(f"SHA-256 or size mismatch: {name}")
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise BundleError(f"Cannot verify bundle: {error}") from error
    return {"bundle": str(bundle_path.resolve()), "fileCount": len(entries), "totalBytes": total_bytes, "createdAt": manifest["createdAt"], "verified": True}


def pack_bundle(project_root: Path) -> dict:
    root = project_root.resolve()
    before = inventory(root)
    output_dir = root / PRIVATE / "exports"
    output_dir.mkdir(exist_ok=True)
    checked_stat(root, output_dir, directory=True)
    now = datetime.now(timezone.utc)
    output = output_dir / f"{now.strftime('%Y%m%dT%H%M%S%fZ')}-{uuid.uuid4().hex[:8]}-bundle.zip"
    with tempfile.NamedTemporaryFile(prefix=".bundle-", suffix=".zip.partial", dir=output_dir, delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        rows = []
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for name, expected in before.items():
                path = root / name
                if fingerprint(checked_stat(root, path)) != expected:
                    raise BundleError(f"Selected file changed before packing: {name}")
                digest = hashlib.sha256()
                size = 0
                info = zipfile.ZipInfo(name, now.timetuple()[:6])
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                    if fingerprint(os.fstat(source.fileno())) != expected:
                        raise BundleError(f"Selected file changed while opening: {name}")
                    for chunk in iter(lambda: source.read(CHUNK_BYTES), b""):
                        target.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                    if fingerprint(os.fstat(source.fileno())) != expected:
                        raise BundleError(f"Selected file changed while packing: {name}")
                if size != expected[0] or fingerprint(checked_stat(root, path)) != expected:
                    raise BundleError(f"Selected file changed while packing: {name}")
                rows.append({"path": name, "sha256": digest.hexdigest(), "bytes": size})
            if inventory(root) != before:
                raise BundleError("Selected files changed during packing; wait for exports to finish and retry")
            manifest = {"schemaVersion": 1, "kind": BUNDLE_KIND, "createdAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "fileCount": len(rows), "totalBytes": sum(row["bytes"] for row in rows), "files": rows}
            encoded = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8") + b"\n"
            if len(encoded) > MAX_MANIFEST_BYTES:
                raise BundleError("Manifest exceeds the size limit")
            archive.writestr(MANIFEST_PATH, encoded)
        result = verify_bundle(temporary_path)
        os.replace(temporary_path, output)
        result["bundle"] = str(output)
        return result
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="Project root to pack (default: this script's project)")
    parser.add_argument("--verify", type=Path, metavar="ZIP", help="Verify an existing bundle without extracting it")
    args = parser.parse_args()
    try:
        result = verify_bundle(args.verify) if args.verify else pack_bundle(args.root)
    except (BundleError, OSError) as error:
        parser.exit(1, f"Bundle error: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
