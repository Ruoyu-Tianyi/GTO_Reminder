#!/usr/bin/env python3
"""Run and export an explicitly approximate local GTOpen preflop study.

This is an original HTTP adapter, not bundled third-party solver source.
Start the separately obtained GTOpen CPU server first. Examples:
  python scripts/solve-local-preflop.py --players 7 8 --iterations 200 --seconds 120
  python scripts/solve-local-preflop.py --players 7 --max-raises 4 --seconds 1800

The default tree stops reraising after the 3-bet. All non-all-in leaves use
modeled continuation, not solved postflop play. This is never exact NLHE GTO.
Output remains in ignored data/private/ unless overridden; audit metadata is
stored separately in data/private/solver-audits/. Imports are <= 8 MB shards.
"""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

POSITIONS = {
    6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
    7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
    8: ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
    9: ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
}
RANKS = "23456789TJQKA"
ENGINE_URL = "https://github.com/MatthewPDingle/GTOpen"
PINNED_COMMIT = "b69ea07c79884fc598757dc45c712e73976db810"


def validate_standard_config(actual, expected):
    if any(actual.get(key) != value for key, value in expected.items()):
        raise RuntimeError("Saved/session configuration differs from the requested configuration")
    if any(value not in (None, False, [], 0) for key, value in actual.items() if key not in expected):
        raise RuntimeError("Saved/session configuration has additional model constraints")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_save(path, config):
    """Validate the pinned engine's bounded JSON header and two raw arenas."""
    before = path.stat()
    with path.open("rb") as stream:
        if stream.readline(32) != b"GTOPREFLOP4\n":
            raise RuntimeError("Restore requires the audited balanced-model v4 save format")
        line = stream.readline(1024 * 1024 + 1)
        if not line.endswith(b"\n") or len(line) > 1024 * 1024:
            raise RuntimeError("Invalid or oversized save header")
        header = json.loads(line)
        validate_standard_config(header["config"], config)
        seats = len(config["positions"])
        if (header.get("multiway_equity_model") != "coupled_deck_v1"
                or header.get("seat_frozen") != [False] * seats
                or header.get("seat_profiles") != [None] * seats
                or header.get("point_locks") != []
                or any(header.get(key) is not None for key in ("hero", "pre_hero_frozen", "hero_backup"))):
            raise RuntimeError("Save has a different model, frozen/profile seats, hero state, or point locks")
        iteration = header.get("iteration")
        if type(iteration) is not int or not 0 <= iteration <= 0xffffffff:
            raise RuntimeError("Invalid saved iteration")
        lengths = []
        for _ in range(2):
            raw = stream.read(8)
            if len(raw) != 8:
                raise RuntimeError("Truncated save arena")
            length = struct.unpack("<Q", raw)[0]
            if length == 0 or length * 4 > before.st_size - stream.tell():
                raise RuntimeError("Invalid save arena length")
            lengths.append(length)
            stream.seek(length * 4, 1)
        if lengths[0] != lengths[1] or stream.tell() != before.st_size:
            raise RuntimeError("Mismatched arenas or unexpected trailing save data")
    digest = sha256_file(path)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise RuntimeError("Save changed while being checked")
    return {"iteration": iteration, "sha256": digest, "bytes": after.st_size}


def validate_resume_audit(audit, config, iteration, commit):
    if audit.get("engineCommit") != commit or audit.get("engineConfig") != config:
        raise RuntimeError("Restore audit engine revision/configuration does not match")
    status = audit.get("status", {})
    if status.get("iteration") != iteration or status.get("published_iteration") != iteration or status.get("state") == "running":
        raise RuntimeError("Restore audit does not describe this stopped snapshot")
    seconds = audit.get("elapsedSeconds", 0)
    if type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds < 0:
        raise RuntimeError("Invalid restore elapsed time")
    previous = -1
    for checkpoint in audit.get("accuracyCheckpoints", []):
        age, gap = checkpoint.get("iteration"), checkpoint.get("modelGapBb")
        if (type(age) is not int or not previous < age <= iteration or type(gap) not in (int, float)
                or not math.isfinite(gap) or gap < 0):
            raise RuntimeError("Invalid historical model-gap checkpoint")
        previous = age
    measured = status.get("accuracy_iteration")
    if measured is not None and (type(measured) is not int or not 0 <= measured <= iteration
            or type(status.get("gap_total")) not in (int, float)
            or not math.isfinite(status["gap_total"]) or status["gap_total"] < 0):
        raise RuntimeError("Invalid restore quality metadata")
    checkpoints = list(audit.get("accuracyCheckpoints", []))
    if measured is not None and (not checkpoints or measured > checkpoints[-1]["iteration"]):
        checkpoints.append({"iteration": measured, "modelGapBb": status["gap_total"]})
    return {**audit, "accuracyCheckpoints": checkpoints}


def matching_resume_audits(args, stem, config, iteration):
    matched = []
    for suffix in (".audit.json", ".pending.audit.json", "-heads-up-lines.audit.json"):
        candidate = args.audit_output / (stem + suffix)
        if candidate.is_file():
            value = json.loads(candidate.read_text(encoding="utf-8"))
            try:
                matched.append(validate_resume_audit(value, config, iteration, args.engine_commit))
            except RuntimeError:
                continue
    return matched


def prepare_restore(args, players):
    config = config_for(args, players)
    stem = study_stem(config, players)
    root = (args.engine_dir / "saves" / "preflop").resolve()
    supplied = args.restore_save
    path = supplied.resolve(strict=True)
    if not path.is_file() or supplied.is_symlink() or path.parent != root or path.name != stem + ".gtop":
        raise RuntimeError(f"Restore path must be the regular engine save {root / (stem + '.gtop')}")
    snapshot = inspect_save(path, config)
    sidecar = path.with_suffix(".resume.json")
    if sidecar.exists():
        audit = json.loads(sidecar.read_text(encoding="utf-8"))
        audit = validate_resume_audit(audit, config, snapshot["iteration"], args.engine_commit)
        if audit.get("save") != snapshot:
            raise RuntimeError("Save checksum/size differs from its restore metadata")
        executable = engine_executable(args)
        if audit.get("engineBinarySha256") != sha256_file(executable):
            raise RuntimeError("Compiled engine differs from the one recorded with this save")
        origin = "checksum-sidecar"
    else:
        # Older project saves predate checksummed sidecars. Only a revision-bearing
        # audit for this exact configuration/iteration may bootstrap one.
        matched = matching_resume_audits(args, stem, config, snapshot["iteration"])
        if not matched:
            raise RuntimeError("Legacy save has no matching revision-bearing audit; refusing unaudited restore")
        audit = max(matched, key=lambda item: item.get("elapsedSeconds", 0))
        origin = "legacy-config-iteration-audit (no historical checksum)"
    return {"path": path, "name": stem, "save": snapshot, "audit": audit, "origin": origin}


def study_stem(config, players):
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:12]
    return f"computed-{players}max-100bb-{digest}"


def engine_executable(args):
    return args.engine_dir.resolve() / "target" / "release" / ("gto-server.exe" if os.name == "nt" else "gto-server")


def tree_boundary(config):
    boundaries = {1: ("open", "3-bet"), 2: ("3-bet", "4-bet"), 3: ("4-bet", "5-bet")}
    if config["max_raises"] not in boundaries:
        return "All decisions are limited to the configured fixed sizing/raise tree."
    faced, excluded = boundaries[config["max_raises"]]
    return (f"Facing the last {faced}, only Fold/Call is modeled; {excluded} and further jam options are excluded "
            "by this tree boundary, not established as strategically inferior or zero-frequency in full NLHE.")


def save_resume_metadata(args, stem, config, status, elapsed, checkpoints):
    """Bind future restoration to the saved bytes, not merely its filename."""
    path = args.engine_dir.resolve() / "saves" / "preflop" / (stem + ".gtop")
    snapshot = inspect_save(path, config)
    if snapshot["iteration"] != status.get("published_iteration") or snapshot["iteration"] != status.get("iteration"):
        raise RuntimeError("Saved iteration differs from the stopped session; no restore metadata written")
    audit = {"engineCommit": args.engine_commit, "engineConfig": config, "status": status,
             "elapsedSeconds": elapsed, "accuracyCheckpoints": checkpoints,
             "save": snapshot, "engineBinarySha256": sha256_file(engine_executable(args))}
    validate_resume_audit(audit, config, snapshot["iteration"], args.engine_commit)
    write_bytes_atomic(path.with_suffix(".resume.json"), json.dumps(audit, indent=2).encode("utf-8"))
    return {"name": stem, **snapshot}


def hand_label(index):
    row, col = divmod(index, 13)
    hi, lo = max(row, col), min(row, col)
    return RANKS[hi] + RANKS[lo] + ("" if hi == lo else "s" if row > col else "o")


def request(base, endpoint, body=None, timeout=120):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + "/api/preflop/" + endpoint, data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{endpoint}: HTTP {exc.code}: {exc.read().decode()}") from exc


def config_for(args, players):
    return {
        "positions": POSITIONS[players], "stack": 100.0,
        "posts": [0.0] * (players - 2) + [0.5, 1.0], "ante": 0.0,
        "limp": args.limp, "open_raises": [args.open_size],
        "raise_mults": [args.threebet_multiplier], "fourbet_mults": [args.fourbet_multiplier],
        "max_raises": args.max_raises, "add_allin": False, "allin_threshold": 0.85,
        "rake_pct": args.rake, "rake_cap": args.rake_cap, "no_flop_no_drop": True,
        "realization": "balanced",
    }


def tree_parameters(config):
    """Fixed Raise-to menus after minimum increments and the jam threshold."""
    def bounded(desired):
        return config["stack"] if desired >= config["allin_threshold"] * config["stack"] else desired
    opened = bounded(config["open_raises"][0])
    threebet = bounded(max(opened * config["raise_mults"][0], 2 * opened - 1))
    fourbet = bounded(max(threebet * config["fourbet_mults"][0], 2 * threebet - opened))
    result = {"openSizeBb": opened, "threeBetSizeBb": threebet, "fourBetSizeBb": fourbet,
              "maxRaises": config["max_raises"], "limp": config["limp"]}
    if config["limp"]:
        # This engine uses the same first-raise menu after a limp; no surcharge.
        result["limpRaiseBb"] = opened
    return result


def action_from_engine(action, index):
    kind = action["kind"]
    if kind not in ("fold", "check", "call", "raise", "jam"):
        raise ValueError(f"Unknown engine action: {kind}")
    result = {"id": f"a{index}", "type": "raise" if kind == "jam" else kind}
    if kind in ("raise", "jam"):
        result["amountBb"] = round(action["to"], 9)
    return result


def convert_node(view, path, history):
    if view.get("strategy_note") or view.get("kind") != "action" or not view.get("strategy"):
        return None
    actions = [action_from_engine(action, i) for i, action in enumerate(view["actions"])]
    strategy, reaches = view["strategy"], view["reach"]
    if len(strategy) != len(actions) * 169 or len(reaches) != 169:
        raise ValueError("Engine returned incorrectly shaped 169-class vectors")
    hands = {}
    for h in range(169):
        reach = reaches[h]
        if not math.isfinite(reach) or not 0 <= reach <= 1:
            raise ValueError("Invalid reach")
        if reach == 0:
            hands[hand_label(h)] = {"status": "unreachable", "reach": 0}
            continue
        frequencies = {action["id"]: strategy[i * 169 + h] for i, action in enumerate(actions)}
        if any(not math.isfinite(f) or not 0 <= f <= 1 for f in frequencies.values()):
            raise ValueError("Invalid conditional frequency")
        if abs(sum(frequencies.values()) - 1) > 1e-6:
            raise ValueError("Engine conditional frequencies do not sum to one")
        hands[hand_label(h)] = {"status": "available", "reach": reach, "frequencies": frequencies}
    return {"id": "root" if not path else "path-" + "-".join(map(str, path)),
            "history": history, "actions": actions, "hands": hands}


def iter_tree(base, max_nodes, coverage, scope="full"):
    """Yield one decision at a time; retain only traversal paths in memory."""
    initial_status = request(base, "status")
    if initial_status.get("state") == "running":
        raise RuntimeError("Cannot export a changing solve; stop it or wait for completion")
    endpoint = urllib.parse.urlsplit(base)
    connection = http.client.HTTPConnection(endpoint.hostname, endpoint.port or 80, timeout=120)
    queue = deque([([], [])])
    skipped, visited, exported, omitted, filtered = [], 0, 0, 0, 0
    publication = None

    def skip(path, reason):
        nonlocal omitted
        omitted += 1
        if len(skipped) < 100:
            skipped.append({"path": path, "reason": reason})

    try:
        while queue:
            if exported >= max_nodes:
                break
            path, history = queue.popleft()
            connection.request("POST", "/api/preflop/node", json.dumps({"path": path}), {"Content-Type": "application/json"})
            response = connection.getresponse()
            payload = response.read()
            if response.status != 200:
                raise RuntimeError(f"node: HTTP {response.status}: {payload.decode()}")
            view = json.loads(payload)
            if publication is None:
                publication = view.get("publication")
            elif view.get("publication") != publication:
                raise RuntimeError("Solver snapshot changed during export; staged files were not imported")
            visited += 1
            if visited % 1000 == 0:
                print(json.dumps({"stage": "export-progress", "visitedNodes": visited,
                                  "exportedDecisions": exported, "queuedPaths": len(queue)}), flush=True)
            node = convert_node(view, path, history)
            if not node:
                if view.get("strategy_note"):
                    skip(path, view["strategy_note"])
                continue
            exported += 1
            yield node
            actor = view["actor_pos"]
            for i, (engine_action, action) in enumerate(zip(view["actions"], node["actions"])):
                if engine_action["freq"] <= 0:
                    skip(path + [i], "Zero aggregate reach under the computed policy")
                    continue
                next_action = {"actor": actor, **{k: v for k, v in action.items() if k != "id"}}
                next_history = history + [next_action]
                if scope == "heads-up-lines" and not is_heads_up_line(next_history):
                    filtered += 1
                    continue
                queue.append((path + [i], next_history))
    finally:
        connection.close()
    final_status = request(base, "status")
    if final_status.get("state") == "running" or any(final_status.get(key) != initial_status.get(key) for key in ("iteration", "published_iteration", "accuracy_iteration")):
        raise RuntimeError("Solver snapshot changed during export; staged files were not imported")
    coverage.update({"visitedNodes": visited, "exportedDecisions": exported,
                     "omittedBranchCount": omitted, "omittedBranchExamples": skipped,
                     "remainingQueuedPaths": len(queue), "exportScope": scope,
                     "branchesOutsideExportScope": filtered,
                     "allDecisionsInExportScopeExported": not queue,
                     "allReachableDecisionsExported": not queue and filtered == 0})


def is_heads_up_line(history):
    contributors, limps, raised = set(), 0, False
    for action in history:
        if action["type"] in ("call", "raise"):
            contributors.add(action["actor"])
        if action["type"] == "call" and not raised:
            limps += 1
        if action["type"] == "raise":
            raised = True
    return len(contributors) <= 2 and limps <= 1


def export_tree(base, max_nodes):
    coverage = {}
    nodes = list(iter_tree(base, max_nodes, coverage))
    return nodes, coverage


def quick_nodes(tree, config):
    """Only schema-v1-representable, single-raiser, complete-reach rows."""
    positions = config["positions"]
    result = []
    for node in tree:
        if any(row["status"] != "available" or row["reach"] != 1 for row in node["hands"].values()):
            continue  # v1 cannot encode reach or unreachable classes.
        history = node["history"]
        if any(a["type"] in ("call", "check") for a in history):
            continue
        raises = [a for a in history if a["type"] == "raise"]
        if len(raises) > 1:
            continue
        hero_index = len(history)
        if hero_index >= len(positions):
            continue
        hero = positions[hero_index]
        if not raises and hero == "BB":
            continue
        if any(a["type"] == "check" for a in node["actions"]):
            continue
        if sum(a["type"] == "raise" for a in node["actions"]) > 1:
            continue
        if not raises and any(a["type"] == "call" for a in node["actions"]):
            continue  # v1 RFI cannot describe an unopened limp option.
        # Read observed bets from the history/actions. For unused future sizing
        # fields, follow this pinned engine's minimum-increment and jam policy;
        # those fields do not assert that the limited tree offers another raise.
        stack = config["stack"]

        def bounded_size(desired):
            return stack if desired >= config["allin_threshold"] * stack else desired

        current_raise = next((a["amountBb"] for a in node["actions"] if a["type"] == "raise"), None)
        open_size = raises[0]["amountBb"] if raises else current_raise
        if open_size is None:
            continue  # No observed opening size can be represented reliably.
        threebet_size = (current_raise if raises and current_raise is not None else
                         bounded_size(max(open_size * config["raise_mults"][0], 2 * open_size - 1)))
        fourbet_size = bounded_size(max(threebet_size * config["fourbet_mults"][0],
                                       2 * threebet_size - open_size))
        spot = {"players": len(positions), "hero": hero,
                "villain": raises[0]["actor"] if raises else None, "stackBb": stack,
                "kind": "vs-open" if raises else "rfi", "openSizeBb": open_size,
                "threeBetSizeBb": threebet_size, "fourBetSizeBb": fourbet_size,
                "format": "cash", "anteBb": 0, "rake": rake_label(config)}
        frequencies = {}
        for hand, row in node["hands"].items():
            totals = {"raise": 0, "call": 0, "fold": 0}
            for action in node["actions"]:
                totals[action["type"]] += row["frequencies"][action["id"]]
            frequencies[hand] = totals
        result.append({"id": node["id"], "spot": spot, "frequencies": frequencies})
    return result


def rake_label(config):
    return f"Local model: {config['rake_pct']:g}% rake, {config['rake_cap']:g} BB cap, no flop no drop"


def write_bytes_atomic(destination, content):
    temporary = destination.with_suffix(destination.suffix + ".partial")
    temporary.write_bytes(content)
    temporary.replace(destination)


def archive_previous(destination):
    if destination.exists():
        archive = destination.parent / "superseded"
        archive.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        destination.replace(archive / (stamp + "-" + destination.name))


def write_tree_chunks(dataset, output, stem, max_bytes=8_000_000):
    """Bound each import file; root remains in part 1 and IDs are unique."""
    shell = {key: value for key, value in dataset.items() if key != "nodes"}
    overhead = len(json.dumps(shell, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 512
    chunks, current, size = [], [], overhead
    for node in dataset["nodes"]:
        node_size = len(json.dumps(node, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
        if node_size + overhead > max_bytes:
            raise ValueError("An individual node exceeds the export-file limit")
        if current and size + node_size > max_bytes:
            chunks.append(current)
            current, size = [], overhead
        current.append(node)
        size += node_size
    if current:
        chunks.append(current)
    files = []
    for index, nodes in enumerate(chunks, 1):
        chunk = {**shell, "id": f"{stem}-part-{index:03d}",
                 "name": shell["name"] + f" · part {index}/{len(chunks)}", "nodes": nodes}
        destination = output / f"{stem}.part-{index:03d}.tree.json"
        encoded = json.dumps(chunk, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > max_bytes:
            raise ValueError("Export shard exceeds requested file limit")
        write_bytes_atomic(destination, encoded)
        files.append({"file": str(destination), "bytes": len(encoded), "nodes": len(nodes)})
    # A resumed/recomputed policy can use fewer shards. Preserve surplus old
    # files in a subdirectory so the top-level import list never mixes runs.
    current_files = {Path(item["file"]).name for item in files}
    for previous in output.glob(stem + ".part-*.tree.json"):
        if previous.name not in current_files:
            archive_previous(previous)
    return files


def stream_tree_chunks(base, dataset, config, output, stem, max_nodes, max_bytes, scope):
    """Spool bounded node arrays, then attach final coverage to each shard."""
    coverage = dataset["computation"]["coverage"]
    qnodes, files = [], []
    staging = output / ".solver-staging"
    staging.mkdir(exist_ok=True)
    # Reserve header space; coverage keeps only a bounded number of examples.
    node_budget = max_bytes - 200_000
    with tempfile.TemporaryDirectory(prefix="export-", dir=staging) as temporary:
        root = Path(temporary)
        spools, chunk, size, count = [], None, 0, 0
        try:
            for node in iter_tree(base, max_nodes, coverage, scope):
                encoded = json.dumps(node, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                if len(encoded) + 2 > node_budget:
                    raise ValueError("An individual decision exceeds the requested export size")
                if chunk is None or size + len(encoded) + 1 > node_budget:
                    if chunk is not None:
                        chunk.write(b"]")
                        chunk.close()
                        spools[-1]["nodes"] = count
                    spool = root / f"nodes-{len(spools) + 1:04d}.json"
                    chunk = spool.open("wb")
                    chunk.write(b"[")
                    spools.append({"path": spool, "nodes": 0})
                    size, count = 2, 0
                if count:
                    chunk.write(b",")
                chunk.write(encoded)
                size += len(encoded) + 1
                count += 1
                qnodes.extend(quick_nodes([node], config))
            if chunk is not None:
                chunk.write(b"]")
                chunk.close()
                spools[-1]["nodes"] = count
        finally:
            if chunk is not None and not chunk.closed:
                chunk.close()
        if not spools:
            raise RuntimeError("No learned reachable strategies were available; nothing exported")
        for index, spool in enumerate(spools, 1):
            shell = {**dataset, "id": f"{stem}-part-{index:03d}",
                     "name": dataset["name"] + f" · part {index}/{len(spools)}"}
            prefix = json.dumps(shell, ensure_ascii=False, separators=(",", ":")).encode("utf-8")[:-1]
            encoded = prefix + b',"nodes":' + spool["path"].read_bytes() + b"}"
            if len(encoded) > max_bytes:
                raise ValueError("Metadata and nodes exceed the requested shard limit")
            destination = output / f"{stem}.part-{index:03d}.tree.json"
            write_bytes_atomic(destination, encoded)
            files.append({"file": str(destination), "bytes": len(encoded), "nodes": spool["nodes"]})
    current = {Path(item["file"]).name for item in files}
    for previous in output.glob(stem + ".part-*.tree.json"):
        if previous.name not in current:
            archive_previous(previous)
    return files, qnodes


def run(args, players):
    active = request(args.url, "status")
    if active.get("state") == "running":
        raise RuntimeError("Another solve is running on this server; refusing to replace its session")
    cfg = config_for(args, players)
    stem = study_stem(cfg, players)
    if hasattr(args, "engine_dir"):
        save_path = args.engine_dir.resolve() / "saves" / "preflop" / (stem + ".gtop")
        if save_path.exists():
            # Validate a destination before spot/solve/save can replace it. This
            # also protects a same-name file copied from another engine/model.
            prepare_restore(argparse.Namespace(**{**vars(args), "restore_save": save_path}), players)
    args.output.mkdir(parents=True, exist_ok=True)
    estimate = request(args.url, "estimate", cfg)
    print(json.dumps({"stage": "estimate", "players": players, **estimate}), flush=True)
    if not estimate["ok"]:
        raise RuntimeError("Tree exceeds server memory/node limits; reduce the configured tree or raise audited limits")
    resumed_from = 0
    previous_seconds = 0
    previous_checkpoints = []
    restored = getattr(args, "restore_checkpoint", None)
    if restored:
        if not getattr(args, "started_server", False) or active.get("state"):
            raise RuntimeError("Restore requires a freshly started, empty engine on a dedicated port")
        if inspect_save(restored["path"], cfg) != restored["save"]:
            raise RuntimeError("Save changed after preflight; refusing to load it")
        request(args.url, "load", {"name": restored["name"]})
    if args.resume:
        session = request(args.url, "session")
        actual = session["config"]
        validate_standard_config(actual, cfg)
        if session.get("hero") is not None or any(session.get("frozen", [])) or any(seat.get("profile") is not None for seat in session.get("seats", [])):
            raise RuntimeError("Existing session has a hero, frozen range, or player profile; refusing to resume it as a standard solve")
        if session.get("realization_note"):
            raise RuntimeError("The engine reports a changed/fallback realization model; refusing misleading balanced-model provenance")
        resumed_from = session["iteration"]
        if restored:
            if resumed_from != restored["save"]["iteration"] or session.get("multiway_equity_model") != "coupled_deck_v1":
                raise RuntimeError("Loaded server session does not match the inspected save")
            previous_seconds = restored["audit"].get("elapsedSeconds", 0)
            previous_checkpoints = restored["audit"].get("accuracyCheckpoints", [])
        if not restored:
            candidates = matching_resume_audits(args, stem, cfg, resumed_from)
            if candidates:
                prior = max(candidates, key=lambda item: item.get("elapsedSeconds", 0))
                previous_seconds = prior.get("elapsedSeconds", 0)
                previous_checkpoints = prior["accuracyCheckpoints"]
    else:
        request(args.url, "spot", cfg)
    start = time.monotonic()
    last_progress = start
    checkpoints = list(previous_checkpoints)
    if not args.export_only:
        request(args.url, "solve", {"iterations": args.iterations, "check_every": args.check_every,
                                    "target_gap": args.target_gap})
    while True:
        status = request(args.url, "status")
        accuracy_iteration = status.get("accuracy_iteration")
        if accuracy_iteration is not None and (not checkpoints or checkpoints[-1]["iteration"] != accuracy_iteration):
            checkpoints.append({"iteration": accuracy_iteration, "modelGapBb": status["gap_total"]})
        if status["state"] != "running":
            break
        if time.monotonic() - last_progress >= 10:
            print(json.dumps({"stage": "progress", "players": players,
                              "elapsedSeconds": round(time.monotonic() - start, 1),
                              "iteration": status.get("iteration"),
                              "accuracyIteration": status.get("accuracy_iteration"),
                              "measuredModelGapBb": status.get("gap_total") if status.get("accuracy_iteration") is not None else None}), flush=True)
            last_progress = time.monotonic()
        if time.monotonic() - start >= args.seconds:
            request(args.url, "stop", {})
            while status["state"] == "running":
                time.sleep(0.25)
                status = request(args.url, "status")
            break
        time.sleep(0.5)
    elapsed = time.monotonic() - start
    # Export-only must not rewrite an identical original save (especially legacy
    # files). Quality is always read from this engine session after load; historic
    # audits/checkpoints never restore convergence or a final gap.
    if status.get("error"):
        raise RuntimeError(f"Solver reported an error; existing saved/exported data was preserved: {status['error']}")
    if status.get("realization_note"):
        raise RuntimeError("The engine reports a changed/fallback realization model; saved/exported data was preserved")
    if not (args.export_only and restored):
        request(args.url, "save", {"name": stem})
    saved_snapshot = save_resume_metadata(args, stem, cfg, status, previous_seconds + elapsed, checkpoints)
    print(json.dumps({"stage": "solved", "players": players, "seconds": elapsed, **status}), flush=True)
    if args.solve_only:
        args.audit_output.mkdir(parents=True, exist_ok=True)
        pending = {"engineCommit": args.engine_commit, "engineConfig": cfg, "status": status, "elapsedSeconds": previous_seconds + elapsed,
                   "latestSolveSeconds": elapsed, "resumedFromIteration": resumed_from,
                   "accuracyCheckpoints": checkpoints, "strategiesExported": False,
                   "savedSnapshot": saved_snapshot,
                   "restoredFrom": {"name": restored["name"], "origin": restored["origin"], **restored["save"]} if restored else None}
        write_bytes_atomic(args.audit_output / f"{stem}.pending.audit.json", json.dumps(pending, indent=2).encode("utf-8"))
        print(json.dumps({"stage": "saved-without-export", "players": players, "study": stem}), flush=True)
        return
    coverage = {}
    converged = status.get("stop_reason") == "target_reached" and status.get("accuracy_iteration") == status.get("published_iteration")
    actual_target = status.get("target_gap") if status.get("target_gap") is not None else args.target_gap
    measured = status.get("accuracy_iteration")
    measured_final = measured is not None and measured == status.get("published_iteration")
    state = ("model target reached" if converged else
             "NOT CONVERGED / model target not reached" if measured_final and status["gap_total"] > actual_target else
             "NOT CONVERGED / model target not confirmed" if measured_final else
             "NOT CONVERGED / accuracy not established for final snapshot")
    metric = (f"summed model best-response gap {status['gap_total']:.9g} BB/hand at iteration {measured}, target {actual_target:g} BB/hand"
              if measured is not None else "final snapshot model best-response gap unmeasured")
    precision = (f"COMPUTED approximate continuation/checkdown model; NOT full NLHE GTO. "
                 f"coupled_deck_v1 (1,024 latent-strength samples; no joint physical-card removal), "
                 f"balanced HU; {status['iteration']} iterations; {state}; {metric}; "
                 f"max raises={args.max_raises}, limps={args.limp}; fixed sizes only. {tree_boundary(cfg)} "
                 "All multiway non-all-in leaves stop betting and use modeled showdown shares; "
                 "HU leaves use relative realization weights. Model best-response gap is not real-game exploitability. "
                 f"Export scope={args.export_scope}; exported paths do not change the solved game tree.")
    source = {"kind": "computed", "name": "COMPUTED · GTOpen approximate continuation/checkdown",
              "url": ENGINE_URL + "/tree/" + args.engine_commit,
              "license": "Locally computed private research output. Upstream code is not bundled; no explicit upstream code redistribution license found at the pinned revision.",
              "retrievedAt": datetime.now(timezone.utc).isoformat(), "precision": precision,
              "computation": {"engine": "GTOpen " + args.engine_commit,
                              "model": "coupled_deck_v1 + balanced HU",
                              "iterations": status["iteration"],
                              "status": "approximate" if converged else "unconverged",
                              "modelGapBb": status.get("gap_total") if measured is not None and measured == status.get("published_iteration") else None,
                              "tree": tree_parameters(cfg),
                              "scope": f"{players} players; equal 100 BB; no ante; open {args.open_size:g} BB; 3bet {args.threebet_multiplier:g}x; later raises {args.fourbet_multiplier:g}x; max {args.max_raises} raises; limps={args.limp}; no extra jam option. {tree_boundary(cfg)} Non-all-in leaves end betting and use approximate continuation; no full postflop solve. {state}; {metric}. The gap measures only this model, not real-game exploitability. Export scope={args.export_scope} (heads-up-lines, when selected, limits exported paths to two voluntary contributors and at most one unopened limp, without changing the solved tree)."}}
    metadata = {"engineCommit": args.engine_commit, "engineConfig": cfg, "status": status,
                "elapsedSeconds": previous_seconds + elapsed, "latestSolveSeconds": elapsed,
                "resumedFromIteration": resumed_from, "exportOnly": args.export_only,
                "savedSnapshot": saved_snapshot,
                "restoredFrom": {"name": restored["name"], "origin": restored["origin"], **restored["save"]} if restored else None,
                "treeEstimate": estimate, "coverage": coverage,
                "accuracyCheckpoints": checkpoints,
                "modelConverged": converged, "exactNlHeGto": False,
                "solver_quality": {"status": "approximate" if converged else "unfinished",
                                   "iterations": status["iteration"],
                                   "accuracyIteration": status.get("accuracy_iteration"),
                                   "measuredModelBestResponseGapBb": status.get("gap_total") if status.get("accuracy_iteration") is not None else None,
                                   "metricAppliesToFinalSnapshot": status.get("accuracy_iteration") == status.get("published_iteration"),
                                   "lastMeasuredCheckpoint": checkpoints[-1] if checkpoints else None,
                                   "targetModelBestResponseGapBb": actual_target,
                                   "realGameExploitability": None,
                                   "limitations": precision}}
    if args.export_scope != "full":
        stem += "-" + args.export_scope
    quality_name = "approximate" if converged else "UNCONVERGED study"
    limp_name = "with limps" if args.limp else "no limps"
    dataset = {"schemaVersion": 2, "id": stem, "name": f"COMPUTED {quality_name} {players}-max 100 BB · max {args.max_raises} raises · {limp_name} · {args.export_scope}",
               "source": source, "game": {"players": players, "stackBb": 100, "anteBb": 0,
               "format": "cash", "rake": rake_label(cfg)}, "computation": metadata}
    files, qnodes = stream_tree_chunks(args.url, dataset, cfg, args.output, stem,
                                      args.max_export_nodes, args.shard_mb * 1_000_000, args.export_scope)
    quick_path = args.output / f"{stem}.quick.json"
    if qnodes:
        quick = {"schemaVersion": 1, "id": stem + "-quick", "name": dataset["name"] + " · RFI/facing open",
                 "source": source, "nodes": qnodes, "computation": metadata}
        write_bytes_atomic(quick_path, json.dumps(quick, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    else:
        archive_previous(quick_path)
    args.audit_output.mkdir(parents=True, exist_ok=True)
    write_bytes_atomic(args.audit_output / f"{stem}.audit.json", json.dumps(metadata, ensure_ascii=False, indent=2).encode("utf-8"))
    print(json.dumps({"stage": "exported", "players": players, "files": files,
                      "decisionNodes": coverage["exportedDecisions"], "quickNodes": len(qnodes),
                      "allReachableExported": coverage["allReachableDecisionsExported"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:3738")
    parser.add_argument("--players", nargs="+", choices=["6", "7", "8", "9", "all"], default=["7", "8"])
    parser.add_argument("--iterations", type=int, default=200)
    parser.add_argument("--seconds", type=float, default=120)
    parser.add_argument("--check-every", type=int, default=10)
    parser.add_argument("--target-gap", type=float, default=0.02)
    parser.add_argument("--max-raises", type=int, choices=range(1, 6), default=2)
    parser.add_argument("--limp", action="store_true")
    parser.add_argument("--open-size", type=float, default=2.5)
    parser.add_argument("--threebet-multiplier", type=float, default=4)
    parser.add_argument("--fourbet-multiplier", type=float, default=3)
    parser.add_argument("--rake", type=float, default=5)
    parser.add_argument("--rake-cap", type=float, default=2.5)
    parser.add_argument("--max-export-nodes", type=int, default=50000, help="Total streamed decisions across shards; each shard stays under 10,000 nodes")
    parser.add_argument("--shard-mb", type=int, default=8, help="Maximum approximate tree-file size in decimal MB")
    parser.add_argument("--export-scope", choices=["full", "heads-up-lines"], default="full", help="heads-up-lines exports only paths with at most two voluntary contributors and one unopened limp; the solved tree is unchanged")
    parser.add_argument("--engine-commit", default=PINNED_COMMIT)
    parser.add_argument("--output", type=Path, default=Path("data/private"))
    parser.add_argument("--audit-output", type=Path, default=Path("data/private/solver-audits"))
    parser.add_argument("--start-server", action="store_true", help="Start an existing compiled engine if the local port is absent")
    parser.add_argument("--resume", action="store_true", help="Continue the existing same-configuration, unconstrained session; one player count only")
    parser.add_argument("--restore-save", type=Path, help="Restore an audited .gtop from engine-dir/saves/preflop on a freshly started dedicated server; requires --start-server and one player count")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--solve-only", action="store_true", help="Compute and save the engine snapshot; defer potentially large JSON exports")
    modes.add_argument("--export-only", action="store_true", help="Export the existing same-configuration session without additional solving")
    parser.add_argument("--engine-dir", type=Path, default=Path(".runtime/gtopen"))
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--memory-mb", type=int, default=4096)
    parser.add_argument("--node-cap", type=int, default=200000)
    args = parser.parse_args()
    args.resume = args.resume or args.export_only or bool(args.restore_save)
    args.started_server = False
    args.restore_checkpoint = None
    if args.resume and (len(args.players) != 1 or args.players[0] == "all"):
        parser.error("Resume requires exactly one explicit player count")
    url = urllib.parse.urlsplit(args.url)
    if url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1") or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        parser.error("The adapter only permits a local HTTP solver; no project data is sent externally")
    args.url = args.url.rstrip("/")
    numeric = [args.seconds, args.target_gap, args.open_size, args.threebet_multiplier,
               args.fourbet_multiplier, args.rake, args.rake_cap]
    if any(not math.isfinite(n) for n in numeric):
        parser.error("All numeric options must be finite")
    if not 0 < args.seconds <= 86400 or not 1 <= args.iterations <= 1_000_000 or args.check_every < 1:
        parser.error("Use seconds in (0, 86400], iterations in [1, 1000000] and check-every >= 1")
    if not 1 <= args.max_export_nodes <= 1_000_000 or not 1 <= args.shard_mb <= 16:
        parser.error("Use max-export-nodes in [1, 1000000] and shard-mb in [1, 16]")
    if not 1 <= args.threads <= (os.cpu_count() or 1) or not 128 <= args.memory_mb <= 65536 or not 100 <= args.node_cap <= 10_000_000:
        parser.error("Threads must fit available logical CPUs; memory-mb in [128, 65536]; node-cap in [100, 10000000]")
    if not 0 <= args.target_gap or not 2 <= args.open_size <= 100 or min(args.threebet_multiplier, args.fourbet_multiplier) <= 1 or not 0 <= args.rake < 100 or args.rake_cap < 0:
        parser.error("Require target-gap >= 0; open-size 2..100 BB; raise multipliers > 1; rake 0..99%; rake-cap >= 0")
    if (args.engine_dir / ".git").exists():
        actual_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.engine_dir, text=True).strip()
        if actual_commit != args.engine_commit:
            parser.error(f"Engine checkout revision {actual_commit} differs from --engine-commit")
    if args.restore_save:
        if not args.start_server or not (args.engine_dir / ".git").exists() or args.engine_commit != PINNED_COMMIT:
            parser.error("Restore requires --start-server and the pinned local Git engine checkout")
        if not engine_executable(args).is_file():
            parser.error("Restore requires the already compiled local engine")
        if subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "crates", "Cargo.toml", "Cargo.lock"], cwd=args.engine_dir).returncode:
            parser.error("Restore requires unchanged engine source at the pinned revision")
        args.restore_checkpoint = prepare_restore(args, int(args.players[0]))
    if args.start_server:
        try:
            request(args.url, "status", timeout=2)
            if args.restore_save:
                raise RuntimeError("Restore refuses an occupied server port; choose an unused local --url port")
            print("Reusing the local solver; thread/memory/node settings remain those of its existing process.", flush=True)
        except (urllib.error.URLError, TimeoutError):
            engine_dir = args.engine_dir.resolve()
            actual_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=engine_dir, text=True).strip()
            if actual_commit != args.engine_commit:
                raise RuntimeError(f"Engine revision {actual_commit} differs from --engine-commit; refusing misleading provenance")
            executable = engine_executable(args)
            if not executable.is_file():
                raise RuntimeError(f"Build the separate engine first: cargo build --release -p server --locked -j 4 (in {engine_dir})")
            env = {**os.environ, "PORT": str(url.port or 80), "SOLVER_THREADS": str(args.threads),
                   "SOLVER_GPU": "0", "SOLVER_MEM_MB": str(args.memory_mb),
                   "PREFLOP_MAX_ARENA_MB": str(args.memory_mb), "PREFLOP_MAX_NODES": str(args.node_cap)}
            args.output.mkdir(parents=True, exist_ok=True)
            with (args.output / "engine.stdout.log").open("ab") as out, (args.output / "engine.stderr.log").open("ab") as err:
                process = subprocess.Popen([str(executable)], cwd=engine_dir, env=env, stdout=out, stderr=err,
                                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            args.started_server = True
            (args.output / "engine.pid").write_text(str(process.pid), encoding="ascii")
            for _ in range(30):
                if process.poll() is not None:
                    raise RuntimeError("Local engine exited; inspect engine.stderr.log")
                try:
                    request(args.url, "status", timeout=1)
                    break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(0.2)
            else:
                raise RuntimeError("Local engine did not become ready")
    players = list(POSITIONS) if "all" in args.players else list(dict.fromkeys(map(int, args.players)))
    for player_count in players:
        run(args, player_count)


if __name__ == "__main__":
    main()
