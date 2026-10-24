#!/usr/bin/env python3
"""Apply/test/build the explicitly restricted local game in a separate checkout.

First obtain the pinned upstream revision in .runtime/gtopen-restricted (keep
the original .runtime/gtopen checkout/binary/saves intact). Then run:
  python scripts/apply-local-solver-patch.py --build --equity-cache .runtime/gtopen/cache/preflop_eq169.bin
The tracked patch contains only local changes, not a vendored upstream engine.
No network access or computation of new equity tables is performed here.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "patches" / "gtopen-restricted-entry-k3-limp1-v1.patch"
MANIFEST = PATCH.with_suffix(".json")


def digest(path, normalized=False):
    data = path.read_bytes()
    if normalized:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def checked_manifest(engine):
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if digest(PATCH) != manifest["patchSha256"]:
        raise RuntimeError("Tracked patch differs from its manifest")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=engine, text=True).strip()
    if revision != manifest["baseCommit"]:
        raise RuntimeError("Patch requires its exact pinned upstream revision")
    return manifest


def verify_sources(engine):
    engine = Path(engine).resolve()
    manifest = checked_manifest(engine)
    changed = subprocess.check_output(["git", "diff", "--name-only", "HEAD", "--", "crates", "Cargo.toml", "Cargo.lock"], cwd=engine, text=True).splitlines()
    untracked = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "--", "crates"], cwd=engine, text=True).splitlines()
    if set(changed + untracked) != set(manifest["sources"]):
        raise RuntimeError("Engine source changes differ from the audited restricted patch")
    for relative, expected in manifest["sources"].items():
        if digest(engine / relative, normalized=True) != expected:
            raise RuntimeError("Modified or missing restricted engine source: " + relative)
    return {"model": manifest["model"], "baseCommit": manifest["baseCommit"],
            "patchSha256": manifest["patchSha256"], "sources": manifest["sources"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine-dir", type=Path, default=ROOT / ".runtime" / "gtopen-restricted")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--equity-cache", type=Path)
    args = parser.parse_args()
    engine = args.engine_dir.resolve(strict=True)
    manifest = checked_manifest(engine)
    try:
        source = verify_sources(engine)
    except RuntimeError:
        dirty = subprocess.check_output(["git", "status", "--porcelain", "--", "crates", "Cargo.toml", "Cargo.lock"], cwd=engine, text=True)
        if dirty:
            raise RuntimeError("Refusing to overwrite unknown local engine source changes")
        # Upstream contains mixed line endings in one Rust fixture. Applying
        # with core.autocrlf=false preserves those bytes instead of double-
        # expanding its CRLF suffix on a Windows checkout.
        for relative in manifest["sources"]:
            original = subprocess.check_output(["git", "show", "HEAD:" + relative], cwd=engine)
            current = (engine / relative).read_bytes()
            if current.replace(b"\r\n", b"\n") != original.replace(b"\r\n", b"\n"):
                raise RuntimeError("Refusing to replace modified source: " + relative)
            (engine / relative).write_bytes(original)
        subprocess.run(["git", "-c", "core.autocrlf=false", "apply", "--check", str(PATCH)], cwd=engine, check=True)
        subprocess.run(["git", "-c", "core.autocrlf=false", "apply", str(PATCH)], cwd=engine, check=True)
        source = verify_sources(engine)
    if args.equity_cache:
        cache = args.equity_cache.resolve(strict=True)
        content = cache.read_bytes()
        if len(content) != 4 + 169 * 169 * 4 or int.from_bytes(content[:4], "little") != 20000:
            raise RuntimeError("Expected a 20,000-sample 169-class pairwise equity cache")
        destination = engine / "cache" / "preflop_eq169.bin"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and destination.read_bytes() != content:
            raise RuntimeError("Refusing to overwrite a different existing equity cache")
        if not destination.exists():
            shutil.copyfile(cache, destination)
    if args.build:
        binary = engine / "target" / "release" / ("gto-server.exe" if os.name == "nt" else "gto-server")
        record = engine / ".restricted-build.json"
        if binary.exists() and not record.exists():
            raise RuntimeError("Existing binary has no restricted-build record; use a separate fresh checkout")
        (engine / "target").mkdir(exist_ok=True)
        subprocess.run(["cargo", "test", "--locked", "-p", "solver", "--lib", "restricted_", "-j", "4"], cwd=engine, check=True)
        subprocess.run(["cargo", "build", "--release", "-p", "server", "--locked", "-j", "4"], cwd=engine, check=True)
        if verify_sources(engine) != source:
            raise RuntimeError("Engine sources changed during build")
        record.write_text(json.dumps({"source": source, "binarySha256": digest(binary),
            "rustc": subprocess.check_output(["rustc", "--version"], text=True).strip(),
            "build": "cargo build --release -p server --locked -j 4", "features": "CPU default"}, indent=2) + "\n", encoding="utf-8")
        print("Built and verified " + str(binary))
    print(json.dumps({"model": source["model"], "patchSha256": source["patchSha256"]}))


if __name__ == "__main__":
    main()
