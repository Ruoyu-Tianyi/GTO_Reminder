#!/usr/bin/env python3
"""Pack, verify, or transactionally restore this project's selected private data.

Only Python's standard library is used. Archive paths are relative to the project
root. Restore adds missing files, skips identical files, and never overwrites
conflicts. A durable local journal supports guarded rollback after interruption.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
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
MAX_BUNDLE_BYTES = 2 * 1024**3
MAX_TOTAL_BYTES = 4 * 1024**3
MAX_PDF_BYTES = 128 * 1024**2
MAX_JSON_BYTES = 32 * 1024**2
MAX_STRATEGY_BYTES = 20 * 1024**2
MAX_CENTRAL_BYTES = 16 * 1024**2
RESTORE_LOCK = f"{PRIVATE}/exports/.restore-lock"
RESTORE_GENERATION = f"{PRIVATE}/exports/.restore-generation"
TRANSACTIONS = ".runtime/data-restores"
TRANSACTION_ID = re.compile(r"[0-9a-f]{32}\Z")


class BundleError(ValueError):
    """An incomplete, unsafe, or inconsistent data bundle."""


def bounded_zip_directory(source) -> None:
    """Reject oversized central directories before ZipFile allocates all entries.

    Payload entries may use ZIP64 local headers (our packer does). ZIP64 EOCD is
    unnecessary under the 2 GiB compressed / 10,001-entry limits and is refused.
    """
    source.seek(0, os.SEEK_END)
    size = source.tell()
    if size > MAX_BUNDLE_BYTES:
        raise BundleError("ZIP exceeds the 2 GiB compressed-size limit")
    source.seek(max(0, size - 65557))
    tail = source.read(65557)
    offset = tail.rfind(b"PK\x05\x06")
    if offset < 0 or len(tail) - offset < 22:
        raise BundleError("Missing ZIP end-of-directory record")
    _, disk, directory_disk, disk_count, count, directory_bytes, directory_offset, comment = struct.unpack("<4s4H2LH", tail[offset:offset + 22])
    if disk or directory_disk or disk_count != count or count > MAX_FILES + 1:
        raise BundleError("Split, ZIP64, or oversized ZIP directories are not supported")
    if directory_bytes > MAX_CENTRAL_BYTES or directory_offset + directory_bytes > size - len(tail) + offset:
        raise BundleError("ZIP central directory exceeds its size/offset limits")
    if offset + 22 + comment != len(tail):
        raise BundleError("Unexpected bytes after the ZIP directory")
    source.seek(0)


def payload_size_limit(name: str) -> int:
    if name.endswith(".pdf"):
        return MAX_PDF_BYTES
    return MAX_STRATEGY_BYTES if name.endswith((".tree.json", ".quick.json")) else MAX_JSON_BYTES


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


def verify_bundle(bundle_path: Path, *, stage: Path | None = None, include_manifest: bool = False) -> dict:
    """Read/hash each member; optionally stage into a newly owned private folder."""
    try:
        before = fingerprint(bundle_path.stat())
        with bundle_path.open("rb") as stream:
            bounded_zip_directory(stream)
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
                limit = MAX_MANIFEST_BYTES if name == MANIFEST_PATH else payload_size_limit(name)
                if info.file_size > limit or info.file_size > max(1, info.compress_size) * 1000:
                    raise BundleError(f"ZIP member exceeds its size or expansion-ratio limit: {name}")
                members[name] = info
                seen_casefold.add(name.casefold())
            if sum(info.file_size for name, info in members.items() if name != MANIFEST_PATH) > MAX_TOTAL_BYTES:
                raise BundleError("ZIP exceeds the 4 GiB expanded-size limit")
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
                target = None
                try:
                    if stage is not None:
                        destination = stage / name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        checked_stat(stage, destination.parent, directory=True)
                        target = destination.open("xb")
                    with archive.open(members[name]) as source:
                        for chunk in iter(lambda: source.read(CHUNK_BYTES), b""):
                            read_bytes += len(chunk)
                            if read_bytes > row["bytes"]:
                                raise BundleError(f"Expanded data exceeds declared size: {name}")
                            digest.update(chunk)
                            if target is not None:
                                target.write(chunk)
                    if target is not None:
                        target.flush()
                        os.fsync(target.fileno())
                finally:
                    if target is not None:
                        target.close()
                if read_bytes != row["bytes"] or digest.hexdigest() != row["sha256"]:
                    raise BundleError(f"SHA-256 or size mismatch: {name}")
        if fingerprint(bundle_path.stat()) != before:
            raise BundleError("Bundle changed while it was being verified")
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise BundleError(f"Cannot verify bundle: {error}") from error
    result = {"bundle": str(bundle_path.resolve()), "fileCount": len(entries), "totalBytes": total_bytes, "createdAt": manifest["createdAt"], "verified": True}
    if include_manifest:
        result["manifest"] = manifest
    return result


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


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def file_identity(info: os.stat_result) -> list[int]:
    return [info.st_dev, info.st_ino]


def safe_directory(root: Path, path: Path) -> None:
    checked_stat(root, root, directory=True)
    current = root
    for part in path.relative_to(root).parts:
        aliases = [item.name for item in current.iterdir() if item.name.casefold() == part.casefold()]
        if aliases and aliases != [part]:
            raise BundleError(f"Case-insensitive directory conflict: {current / part}")
        current = current / part
        current.mkdir(exist_ok=True)
        checked_stat(root, current, directory=True)


def destination_path(root: Path, name: str) -> Path:
    if not is_allowed_payload(name):
        raise BundleError(f"Destination is outside the whitelist: {name}")
    current = root
    for part in PurePosixPath(name).parts:
        if current.exists():
            checked_stat(root, current, directory=True)
            aliases = [item.name for item in current.iterdir() if item.name.casefold() == part.casefold()]
            if aliases and aliases != [part]:
                raise BundleError(f"Case-insensitive destination conflict: {name}")
        current = current / part
    return current


def hash_regular_file(root: Path, path: Path) -> dict:
    before = checked_stat(root, path)
    digest = hashlib.sha256()
    read_bytes = 0
    with path.open("rb") as source:
        if fingerprint(os.fstat(source.fileno())) != fingerprint(before):
            raise BundleError(f"File changed while opening: {path}")
        for chunk in iter(lambda: source.read(CHUNK_BYTES), b""):
            digest.update(chunk)
            read_bytes += len(chunk)
        if fingerprint(os.fstat(source.fileno())) != fingerprint(before):
            raise BundleError(f"File changed while reading: {path}")
    if fingerprint(checked_stat(root, path)) != fingerprint(before):
        raise BundleError(f"File changed while reading: {path}")
    return {"sha256": digest.hexdigest(), "bytes": read_bytes, "identity": file_identity(before)}


def write_journal(path: Path, journal: dict) -> None:
    temporary = path.with_name(path.name + ".partial")
    with temporary.open("wb") as output:
        output.write(json.dumps(journal, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def advance_generation(root: Path) -> str:
    """Persist a fresh API epoch while holding the restore lock, before mutation.

    The token survives unlock, so an API read can detect a whole restore/rollback
    that began and ended between its two lock checks (the absent-lock ABA case).
    """
    path = root / RESTORE_GENERATION
    if path.exists() or path.is_symlink():
        checked_stat(root, path)
    token = uuid.uuid4().hex
    temporary = path.with_name(path.name + "." + token + ".partial")
    try:
        with temporary.open("xb") as output:
            output.write((token + "\n").encode("ascii"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return token


def plan_restore(root: Path, rows: list[dict]) -> tuple[list[dict], list[str]]:
    additions, skipped, conflicts = [], [], []
    for row in rows:
        target = destination_path(root, row["path"])
        if target.exists() or target.is_symlink():
            current = hash_regular_file(root, target)
            if current["bytes"] == row["bytes"] and current["sha256"] == row["sha256"]:
                skipped.append(row["path"])
            else:
                conflicts.append(row["path"])
        else:
            additions.append(dict(row))
    if conflicts:
        raise BundleError("Restore conflicts; no files were published: " + ", ".join(conflicts))
    return additions, skipped


def copy_pinned_bundle(source: Path, target: Path) -> str:
    before = source.lstat()
    if not stat.S_ISREG(before.st_mode) or getattr(before, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
        raise BundleError("Bundle source must be a regular file, not a link/reparse point")
    if before.st_size > MAX_BUNDLE_BYTES:
        raise BundleError("ZIP exceeds the 2 GiB compressed-size limit")
    digest = hashlib.sha256()
    copied = 0
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        if fingerprint(os.fstat(incoming.fileno())) != fingerprint(before):
            raise BundleError("Bundle changed while opening it")
        for chunk in iter(lambda: incoming.read(CHUNK_BYTES), b""):
            copied += len(chunk)
            if copied > before.st_size:
                raise BundleError("Bundle grew while copying it")
            outgoing.write(chunk)
            digest.update(chunk)
        outgoing.flush()
        os.fsync(outgoing.fileno())
        if fingerprint(os.fstat(incoming.fileno())) != fingerprint(before):
            raise BundleError("Bundle changed while copying it")
    if copied != before.st_size or fingerprint(source.lstat()) != fingerprint(before):
        raise BundleError("Bundle changed while copying it")
    return digest.hexdigest()


def process_alive(pid: int) -> bool:
    if type(pid) is not int or pid <= 0:
        return True  # Unrecognizable ownership is not permission to take a lock.
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() != 87  # ERROR_INVALID_PARAMETER: no such PID.
        try:
            code = wintypes.DWORD()
            return not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


@contextmanager
def hold_directories(root: Path, paths: list[Path]):
    """Windows directory handles prevent rename/reparse replacement while held.

    Other systems still validate ancestors and require cooperating writers. The
    local restore lock is not an inter-process lock for arbitrary external tools.
    """
    handles = []
    kernel = None
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
            kernel.CreateFileW.restype = wintypes.HANDLE
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            for path in sorted(set(paths), key=lambda item: len(item.parts)):
                checked_stat(root, path, directory=True)
                handle = kernel.CreateFileW(str(path), 0x80, 1, None, 3, 0x02200000, None)
                if handle == ctypes.c_void_p(-1).value:
                    raise BundleError(f"Could not guard restore directory: {path} (Windows {ctypes.get_last_error()})")
                handles.append(handle)
                checked_stat(root, path, directory=True)
        else:
            for path in set(paths):
                checked_stat(root, path, directory=True)
        yield
    finally:
        if kernel is not None:
            for handle in reversed(handles):
                kernel.CloseHandle(handle)


@contextmanager
def recovery_claim(root: Path, transaction: Path):
    """Kernel-owned, nonblocking exclusion for recovery of one transaction.

    The file is permanent: unlinking it would allow another process to lock a
    new inode while a previous owner still holds the old one. A process exit
    releases the handle/flock automatically, including an ungraceful exit.
    """
    path = transaction / ".recovery-claim"
    checked_stat(root, transaction, directory=True)
    if path.exists() or path.is_symlink():
        checked_stat(root, path)
    descriptor = None
    try:
        if os.name == "nt":
            import ctypes
            import msvcrt
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
            kernel.CreateFileW.restype = wintypes.HANDLE
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            # OPEN_ALWAYS with no sharing is the mutex; directory handles alone
            # guard paths but do not serialize two recovery processes.
            handle = kernel.CreateFileW(str(path), 0xC0000000, 0, None, 4, 0x00200000, None)
            if handle == ctypes.c_void_p(-1).value:
                raise BundleError(f"Another recovery owns this transaction or its claim is unavailable (Windows {ctypes.get_last_error()})")
            try:
                descriptor = msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)
            except BaseException:
                kernel.CloseHandle(handle)
                raise
        else:
            import fcntl
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0), 0o600)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BundleError("Another recovery owns this transaction") from error
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or file_identity(info) != file_identity(checked_stat(root, path)):
            raise BundleError("Recovery claim changed or is not a regular file")
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)


def delete_owned_file(root: Path, target: Path, entry: dict) -> bool:
    """Delete only the original transaction inode with unchanged bytes."""
    if os.name == "nt":
        import ctypes
        import msvcrt
        from ctypes import wintypes
        checked_stat(root, target)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        handle = kernel.CreateFileW(str(target), 0x80010000, 1, None, 3, 0x00200000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise BundleError(f"Could not exclusively inspect rollback file: {target}")
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        with os.fdopen(descriptor, "rb") as incoming:
            info = os.fstat(incoming.fileno())
            digest = hashlib.sha256()
            for chunk in iter(lambda: incoming.read(CHUNK_BYTES), b""):
                digest.update(chunk)
            if file_identity(info) != entry["identity"] or info.st_size != entry["bytes"] or digest.hexdigest() != entry["sha256"]:
                return False
            # FileDispositionInfo marks the inspected handle for deletion on close.
            # Write/delete sharing is denied, so another writer cannot swap paths
            # between the hash check and deletion on the supported Windows host.
            disposition = wintypes.BOOL(True)
            if not kernel.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
                raise BundleError(f"Could not remove unchanged rollback file: {target}")
        return True
    current = hash_regular_file(root, target)
    if any(current[key] != entry[key] for key in ("identity", "bytes", "sha256")):
        return False
    if file_identity(checked_stat(root, target)) != entry["identity"]:
        return False
    target.unlink()
    return True


def read_lock(root: Path) -> dict | None:
    path = root / RESTORE_LOCK
    if not path.exists() and not path.is_symlink():
        return None
    if checked_stat(root, path).st_size > 65536:
        raise BundleError("Unrecognized restore lock; refusing to remove it")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        transaction_id = value["transactionId"]
        if (value.get("schemaVersion") != 1 or not isinstance(transaction_id, str)
                or not TRANSACTION_ID.fullmatch(transaction_id)
                or value.get("journal") != f"{TRANSACTIONS}/{transaction_id}/journal.json"
                or type(value.get("pid")) is not int or value["pid"] <= 0):
            raise ValueError("Invalid lock fields")
        return value
    except (ValueError, KeyError, TypeError) as error:
        raise BundleError("Unrecognized restore lock; inspect the journal before recovery") from error


def acquire_lock(root: Path, transaction_id: str, transaction: Path) -> dict:
    value = {"schemaVersion": 1, "transactionId": transaction_id, "pid": os.getpid(),
             "createdAt": utc_now(), "journal": f"{TRANSACTIONS}/{transaction_id}/journal.json"}
    seed = transaction / "lock.json"
    write_journal(seed, value)
    try:
        # Complete JSON is published in one exclusive operation, never a partially
        # written lock that cannot identify its transaction after a crash.
        os.link(seed, root / RESTORE_LOCK)
    except FileExistsError as error:
        raise BundleError("Another restore lock appeared; no data was published") from error
    return value


def release_lock(root: Path, expected: dict) -> None:
    if read_lock(root) != expected:
        raise BundleError("Restore lock ownership changed; it was preserved")
    entry = hash_regular_file(root, root / RESTORE_LOCK)
    if not delete_owned_file(root, root / RESTORE_LOCK, entry):
        raise BundleError("Restore lock changed while releasing it")


def load_journal(root: Path, transaction_id: str) -> tuple[Path, dict]:
    if not isinstance(transaction_id, str) or not TRANSACTION_ID.fullmatch(transaction_id):
        raise BundleError("Transaction ID must be 32 lowercase hexadecimal characters")
    path = root / TRANSACTIONS / transaction_id / "journal.json"
    if checked_stat(root, path).st_size > MAX_MANIFEST_BYTES * 4:
        raise BundleError("Restore journal is too large")
    try:
        journal = json.loads(path.read_text(encoding="utf-8"))
        if (journal.get("schemaVersion") != 1 or journal.get("kind") != "gto-private-data-restore"
                or journal.get("transactionId") != transaction_id or journal.get("root") != str(root)
                or journal.get("state") not in ("staged", "publishing", "complete", "rolling-back", "rolled-back", "rollback-blocked")):
            raise ValueError("Invalid restore journal metadata")
        files = journal["files"]
        if not isinstance(files, list) or len(files) > MAX_FILES:
            raise ValueError("Invalid restore file list")
        seen = set()
        for row in files:
            name = row["path"]
            identity = row.get("identity")
            if (not is_allowed_payload(name) or name.casefold() in seen
                    or not SHA256.fullmatch(row["sha256"]) or type(row["bytes"]) is not int
                    or not 0 <= row["bytes"] <= payload_size_limit(name)
                    or row.get("state") not in ("planned", "pending", "created", "rolled-back", "not-installed")
                    or (identity is not None and (not isinstance(identity, list) or len(identity) != 2
                        or any(type(part) is not int or part < 0 for part in identity)))):
                raise ValueError("Invalid restore journal row")
            if row["state"] in ("pending", "created") and identity is None:
                raise ValueError("Missing published-file identity")
            seen.add(name.casefold())
        return path, journal
    except (ValueError, KeyError, TypeError) as error:
        raise BundleError(f"Invalid restore journal: {path}") from error


def rollback_files(root: Path, journal_path: Path, journal: dict) -> list[str]:
    # Automatic rollback is a separate mutation phase, even in the same process
    # and transaction; never reuse the publication epoch.
    advance_generation(root)
    journal["state"] = "rolling-back"
    write_journal(journal_path, journal)
    blocked = []
    for row in reversed(journal["files"]):
        if row["state"] not in ("pending", "created"):
            continue
        try:
            target = destination_path(root, row["path"])
            if not target.exists() and not target.is_symlink():
                row["state"] = "rolled-back"
            else:
                info = checked_stat(root, target)
                if row["state"] == "pending" and file_identity(info) != row["identity"]:
                    # The exclusive publication failed because somebody else
                    # created this path. It was never ours to remove.
                    row["state"] = "not-installed"
                elif delete_owned_file(root, target, row):
                    row["state"] = "rolled-back"
                else:
                    blocked.append(row["path"])
        except (OSError, BundleError):
            blocked.append(row["path"])
        write_journal(journal_path, journal)
    journal["state"] = "rollback-blocked" if blocked else "rolled-back"
    journal["blockedFiles"] = blocked
    journal["updatedAt"] = utc_now()
    write_journal(journal_path, journal)
    return blocked


def rollback_transaction(project_root: Path, transaction_id: str, *, stale_recovery: bool = False) -> dict:
    root = project_root.resolve()
    if not isinstance(transaction_id, str) or not TRANSACTION_ID.fullmatch(transaction_id):
        raise BundleError("Transaction ID must be 32 lowercase hexadecimal characters")
    transaction = root / TRANSACTIONS / transaction_id
    with hold_directories(root, [root, root / ".runtime", root / TRANSACTIONS, transaction]), recovery_claim(root, transaction):
        # These reads are authoritative only after acquiring the recovery claim.
        # A previous claimant might have finished while this process was starting.
        journal_path, journal = load_journal(root, transaction_id)
        lock = read_lock(root)
        if lock and (lock["transactionId"] != transaction_id or process_alive(lock["pid"])):
            raise BundleError("A live or different restore owns the lock; it was not interrupted")
        directories = [root / "data", root / PRIVATE, root / PRIVATE / "exports"]
        directories += [root / PurePosixPath(row["path"]).parent for row in journal["files"]]
        with hold_directories(root, [path for path in directories if path.exists()]):
            if lock is None:
                lock = acquire_lock(root, transaction_id, transaction)
            else:
                # Adopt the stale lock atomically so other transactions also see
                # an active PID. Same-transaction claimants remain excluded by
                # the kernel claim until all recovery writes and unlock finish.
                if read_lock(root) != lock:
                    raise BundleError("Restore lock changed before recovery; it was preserved")
                lock = {**lock, "pid": os.getpid(), "recoveredAt": utc_now()}
                write_journal(root / RESTORE_LOCK, lock)
            # A crash after the complete marker must not undo a successful import.
            if stale_recovery and journal["state"] in ("complete", "rolled-back"):
                advance_generation(root)
                release_lock(root, lock)
                return {"transactionId": transaction_id, "state": journal["state"], "recoveredLock": True}
            blocked = rollback_files(root, journal_path, journal)
            if blocked:
                raise BundleError("Rollback preserved changed/unavailable files; lock retained. Move your changed files to a safe location and retry --rollback " + transaction_id + ": " + ", ".join(blocked))
            release_lock(root, lock)
    return {"transactionId": transaction_id, "state": "rolled-back", "removedFiles": sum(row["state"] == "rolled-back" for row in journal["files"])}


def publish_file(source: Path, target: Path) -> None:
    """Same-volume hard link atomically adds a complete file, never replaces one."""
    os.link(source, target)


def restore_bundle(project_root: Path, bundle_path: Path, *, dry_run: bool = False) -> dict:
    root = project_root.resolve()
    checked_stat(root, root, directory=True)
    existing_lock = read_lock(root)
    if existing_lock:
        if dry_run or process_alive(existing_lock["pid"]):
            raise BundleError("Private data has an active/unresolved restore lock")
        rollback_transaction(root, existing_lock["transactionId"], stale_recovery=True)
    if dry_run:
        with tempfile.TemporaryDirectory(prefix="gto-restore-preview-") as temporary:
            pinned = Path(temporary) / "source.zip"
            digest = copy_pinned_bundle(bundle_path, pinned)
            result = verify_bundle(pinned, include_manifest=True)
            additions, skipped = plan_restore(root, result["manifest"]["files"])
        return {"dryRun": True, "bundleSha256": digest, "addFiles": len(additions), "skipIdenticalFiles": len(skipped),
                "addBytes": sum(row["bytes"] for row in additions), "pathsToAdd": [row["path"] for row in additions]}
    transaction_id = uuid.uuid4().hex
    transaction = root / TRANSACTIONS / transaction_id
    safe_directory(root, transaction)
    with hold_directories(root, [root, root / ".runtime", root / TRANSACTIONS, transaction]):
        return restore_transaction(root, bundle_path, transaction, transaction_id)


def restore_transaction(root: Path, bundle_path: Path, transaction: Path, transaction_id: str) -> dict:
    pinned = transaction / "source.zip"
    if shutil.disk_usage(root).free < bundle_path.stat().st_size + 64 * 1024**2:
        raise BundleError("Insufficient free disk space for the pinned bundle")
    digest = copy_pinned_bundle(bundle_path, pinned)
    verified = verify_bundle(pinned, include_manifest=True)
    rows = verified["manifest"]["files"]
    additions, skipped = plan_restore(root, rows)
    if not additions:
        if read_lock(root):
            raise BundleError("Another restore started while this bundle was being checked")
        # No transaction changed the destination. Do not leave another full ZIP
        # backup behind on every idempotent invocation; the empty directory is
        # harmless and retained because its Windows guard is still held.
        pinned.unlink()
        return {"state": "unchanged", "bundleSha256": digest,
                "addedFiles": 0, "skippedIdenticalFiles": len(skipped)}
    if shutil.disk_usage(root).free < verified["totalBytes"] + 64 * 1024**2:
        raise BundleError("Insufficient free disk space for verified staging and a safety margin")
    payload = transaction / "payload"
    safe_directory(root, payload)
    verify_bundle(pinned, stage=payload)
    journal_path = transaction / "journal.json"
    journal = {"schemaVersion": 1, "kind": "gto-private-data-restore", "transactionId": transaction_id,
               "root": str(root), "createdAt": utc_now(), "bundleSha256": digest, "state": "staged",
               "files": [{**row, "state": "planned", "identity": None} for row in additions], "skippedIdentical": skipped}
    write_journal(journal_path, journal)
    for parent in {PurePosixPath(row["path"]).parent for row in rows} | {PurePosixPath(RESTORE_LOCK).parent}:
        safe_directory(root, root / parent)
    directories = [root, root / "data", root / PRIVATE, root / PRIVATE / "exports", root / ".runtime", root / TRANSACTIONS, transaction]
    directories += [root / PurePosixPath(row["path"]).parent for row in rows]
    directories += [payload, payload / "data", payload / PRIVATE]
    directories += [payload / PurePosixPath(row["path"]).parent for row in rows]
    with hold_directories(root, directories):
        lock = acquire_lock(root, transaction_id, transaction)
        try:
            advance_generation(root)
            # Recheck after taking the API lock: the dry plan is never authority
            # to overwrite a file that appeared while decompression was running.
            additions, skipped = plan_restore(root, rows)
            journal["files"] = [{**row, "state": "planned", "identity": None} for row in additions]
            journal["skippedIdentical"] = skipped
            journal["state"] = "publishing"
            write_journal(journal_path, journal)
            for row in journal["files"]:
                target = destination_path(root, row["path"])
                source = payload / row["path"]
                current = hash_regular_file(root, source)
                if current["bytes"] != row["bytes"] or current["sha256"] != row["sha256"]:
                    raise BundleError(f"Staged payload changed: {row['path']}")
                row["identity"] = current["identity"]
                row["state"] = "pending"
                write_journal(journal_path, journal)
                publish_file(source, target)
                actual = hash_regular_file(root, target)
                if any(actual[key] != row[key] for key in ("identity", "bytes", "sha256")):
                    raise BundleError(f"Published payload changed: {row['path']}")
                row["state"] = "created"
                write_journal(journal_path, journal)
            journal["state"] = "complete"
            journal["completedAt"] = utc_now()
            write_journal(journal_path, journal)
            release_lock(root, lock)
        except BaseException as error:
            blocked = rollback_files(root, journal_path, journal)
            if not blocked:
                release_lock(root, lock)
            else:
                raise BundleError("Restore failed and rollback preserved changed files; lock retained. Retry --rollback " + transaction_id + " after safeguarding: " + ", ".join(blocked)) from error
            raise
    return {"transactionId": transaction_id, "state": "complete", "bundleSha256": digest,
            "addedFiles": len(journal["files"]), "skippedIdenticalFiles": len(skipped),
            "journal": str(journal_path), "backupBundle": str(pinned)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="Project root to pack or restore (default: this script's project)")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--verify", type=Path, metavar="ZIP", help="Verify an existing bundle without extracting it")
    modes.add_argument("--restore", type=Path, metavar="ZIP", help="Add verified private data; skip identical files and reject every conflict")
    modes.add_argument("--rollback", metavar="TRANSACTION_ID", help="Undo only unchanged files created by this local restore transaction")
    parser.add_argument("--dry-run", action="store_true", help="Preview --restore without modifying the destination workspace")
    args = parser.parse_args()
    if args.dry_run and not args.restore:
        parser.error("--dry-run requires --restore ZIP")
    try:
        if args.restore:
            result = restore_bundle(args.root, args.restore, dry_run=args.dry_run)
        elif args.rollback:
            result = rollback_transaction(args.root, args.rollback)
        else:
            result = verify_bundle(args.verify) if args.verify else pack_bundle(args.root)
    except (BundleError, OSError) as error:
        parser.exit(1, f"Bundle error: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
