#!/usr/bin/env python3
"""Offline adapter regressions. Uses synthetic fixtures; never starts a solver."""
from contextlib import redirect_stderr, redirect_stdout
import copy
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name('solve-local-preflop.py')
SPEC = importlib.util.spec_from_file_location('local_solver_adapter', SCRIPT)
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


def options(**overrides):
    values = dict(limp=False, open_size=2.5, threebet_multiplier=4,
                  fourbet_multiplier=3, max_raises=2, rake=5, rake_cap=2.5,
                  url='http://127.0.0.1:3738', resume=False, export_only=True,
                  solve_only=False, iterations=20, check_every=10, seconds=1,
                  target_gap=.02, engine_commit=adapter.PINNED_COMMIT,
                  export_scope='full', max_export_nodes=100, shard_mb=1)
    return SimpleNamespace(**{**values, **overrides})


def view(actions=None):
    actions = actions or [{'kind': 'fold'}, {'kind': 'raise', 'to': 2.5}]
    return {'kind': 'action', 'actions': actions,
            'reach': [1.0] * 169, 'strategy': [1 / len(actions)] * (169 * len(actions))}


def node(history=None, actions=None):
    return adapter.convert_node(view(actions), [], history or [])


class ConversionTests(unittest.TestCase):
    def test_canonical_hand_mapping_and_action_major_vectors(self):
        ranks = 'AKQJT98765432'
        # Independently form all rank pairs plus both suit classes.
        expected = {r + r for r in ranks} | {a + b + suffix for i, a in enumerate(ranks)
                    for b in ranks[i + 1:] for suffix in ('s', 'o')}
        self.assertEqual({adapter.hand_label(i) for i in range(169)}, expected)
        self.assertEqual([adapter.hand_label(i) for i in (0, 1, 13, 155, 167, 168)],
                         ['22', '32o', '32s', 'AKo', 'AKs', 'AA'])
        raw = view()
        raw['strategy'] = [i / 168 for i in range(169)] + [1 - i / 168 for i in range(169)]
        converted = adapter.convert_node(raw, [1, 0], [])
        self.assertEqual(converted['id'], 'path-1-0')
        self.assertEqual(converted['hands']['AA']['frequencies'], {'a0': 1, 'a1': 0})
        self.assertEqual(converted['hands']['22']['frequencies'], {'a0': 0, 'a1': 1})

    def test_strategy_note_and_zero_reach_never_become_fold(self):
        raw = view()
        raw['strategy_note'] = 'No learned strategy'
        self.assertIsNone(adapter.convert_node(raw, [], []))
        del raw['strategy_note']
        raw['reach'][168] = 0
        converted = adapter.convert_node(raw, [], [])
        self.assertEqual(converted['hands']['AA'], {'status': 'unreachable', 'reach': 0})
        self.assertEqual(adapter.quick_nodes([converted], adapter.config_for(options(), 6)), [])

    def test_invalid_vector_shape_reach_and_frequencies_fail_closed(self):
        for mutate in (lambda raw: raw['reach'].pop(), lambda raw: raw['strategy'].pop(),
                       lambda raw: raw['reach'].__setitem__(0, math.nan),
                       lambda raw: raw['reach'].__setitem__(0, 1.01),
                       lambda raw: raw['strategy'].__setitem__(0, math.inf),
                       lambda raw: raw['strategy'].__setitem__(0, .9)):
            raw = view(); mutate(raw)
            with self.subTest(raw=raw['reach'][:1]), self.assertRaises(ValueError):
                adapter.convert_node(raw, [], [])

    def test_limp_rfi_and_partial_reach_do_not_export_to_v1(self):
        config = adapter.config_for(options(limp=True), 6)
        unopened = node(actions=[{'kind': 'fold'}, {'kind': 'call'}, {'kind': 'raise', 'to': 2.5}])
        self.assertEqual(adapter.quick_nodes([unopened], config), [])
        partial = node(); partial['hands']['AA']['reach'] = .5
        self.assertEqual(adapter.quick_nodes([partial], config), [])
        # A limp-capable model can still export a complete-reach facing-open node.
        response = node([{'actor': 'UTG', 'type': 'raise', 'amountBb': 2.5}],
                        [{'kind': 'fold'}, {'kind': 'call'}, {'kind': 'raise', 'to': 10}])
        self.assertEqual(adapter.quick_nodes([response], config)[0]['spot']['kind'], 'vs-open')

    def test_observed_jam_size_and_minimum_full_raise_override_multiplier(self):
        config = adapter.config_for(options(open_size=30), 6)
        response = node([{'actor': 'UTG', 'type': 'raise', 'amountBb': 30}],
                        [{'kind': 'fold'}, {'kind': 'call'}, {'kind': 'jam', 'to': 100}])
        spot = adapter.quick_nodes([response], config)[0]['spot']
        self.assertEqual((spot['openSizeBb'], spot['threeBetSizeBb'], spot['fourBetSizeBb']), (30, 100, 100))
        config = adapter.config_for(options(open_size=10, threebet_multiplier=1.1, fourbet_multiplier=1.1), 6)
        opened = node(actions=[{'kind': 'fold'}, {'kind': 'raise', 'to': 10}])
        spot = adapter.quick_nodes([opened], config)[0]['spot']
        self.assertEqual((spot['threeBetSizeBb'], spot['fourBetSizeBb']), (19, 28))

    def test_heads_up_export_filter_counts_contributors_not_current_survivors(self):
        history = [{'actor': 'UTG', 'type': 'raise', 'amountBb': 2.5}, {'actor': 'HJ', 'type': 'call'}]
        self.assertTrue(adapter.is_heads_up_line(history))
        self.assertFalse(adapter.is_heads_up_line(history + [{'actor': 'BTN', 'type': 'raise', 'amountBb': 10}]))
        self.assertFalse(adapter.is_heads_up_line([{'actor': 'UTG', 'type': 'call'}, {'actor': 'HJ', 'type': 'call'}]))


class ExportTests(unittest.TestCase):
    def test_bounded_shards_and_surplus_files_are_archived(self):
        raw = node()
        nodes = [{**copy.deepcopy(raw), 'id': f'node-{i}'} for i in range(3)]
        dataset = {'id': 'test', 'name': 'Synthetic', 'nodes': nodes}
        node_bytes = len(json.dumps(raw, separators=(',', ':')).encode())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            files = adapter.write_tree_chunks(dataset, output, 'test', node_bytes + 1000)
            self.assertEqual(len(files), 3)
            self.assertTrue(all(item['bytes'] <= node_bytes + 1000 for item in files))
            self.assertEqual(json.loads(Path(files[0]['file']).read_text())['id'], 'test-part-001')
            dataset['nodes'] = nodes[:1]
            adapter.write_tree_chunks(dataset, output, 'test', node_bytes + 1000)
            self.assertEqual(len(list(output.glob('*.tree.json'))), 1)
            self.assertEqual(len(list((output / 'superseded').glob('*.tree.json'))), 2)
            with self.assertRaises(ValueError):
                adapter.write_tree_chunks(dataset, output, 'bad', 100)

    def test_stream_export_attaches_final_coverage_to_every_bounded_part(self):
        nodes = [{**node(), 'id': f'node-{i}'} for i in range(4)]
        dataset = {'id': 'test', 'name': 'Synthetic', 'computation': {'coverage': {}}}
        def synthetic_tree(base, max_nodes, coverage, scope):
            yield from nodes
            coverage.update({'exportedDecisions': 4, 'allReachableDecisionsExported': True})
        with tempfile.TemporaryDirectory() as directory, patch.object(adapter, 'iter_tree', synthetic_tree):
            files, quick = adapter.stream_tree_chunks('unused', dataset, adapter.config_for(options(), 6), Path(directory), 'test', 10, 220_000, 'full')
            self.assertGreater(len(files), 1)
            self.assertEqual(sum(item['nodes'] for item in files), 4)
            self.assertEqual(len(quick), 4)
            for item in files:
                content = Path(item['file']).read_bytes()
                self.assertLessEqual(len(content), 220_000)
                self.assertEqual(json.loads(content)['computation']['coverage']['exportedDecisions'], 4)

    def test_empty_quick_reexport_archives_previous_quick_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = options(output=output, audit_output=output / 'audits')
            config = adapter.config_for(args, 6)
            digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:12]
            old = output / f'computed-6max-100bb-{digest}.quick.json'
            old.write_text('old snapshot', encoding='utf-8')
            def request(base, endpoint, body=None):
                if endpoint == 'estimate': return {'ok': True}
                if endpoint == 'status': return {'state': 'complete', 'iteration': 20, 'published_iteration': 20, 'accuracy_iteration': None}
                return {}
            def stream(base, dataset, config, output, stem, max_nodes, max_bytes, scope):
                dataset['computation']['coverage'].update({'exportedDecisions': 1, 'allReachableDecisionsExported': False})
                return [], []
            with patch.object(adapter, 'request', request), patch.object(adapter, 'stream_tree_chunks', stream), patch.object(adapter, 'save_resume_metadata', return_value={}), redirect_stdout(io.StringIO()):
                adapter.run(args, 6)
            self.assertFalse(old.exists())
            self.assertEqual(next((output / 'superseded').glob('*.quick.json')).read_text(), 'old snapshot')
            audit = json.loads(next(args.audit_output.glob('*.audit.json')).read_text())
            self.assertIsNone(audit['solver_quality']['measuredModelBestResponseGapBb'])
            self.assertFalse(audit['solver_quality']['metricAppliesToFinalSnapshot'])

    def test_invalid_resource_and_remote_cli_options_reject_before_network(self):
        for arguments in (['--threads', '0'], ['--memory-mb', '64'], ['--node-cap', '1'],
                          ['--iterations', '0'], ['--seconds', 'nan'], ['--max-export-nodes', '1000001'],
                          ['--shard-mb', '17'], ['--url', 'https://example.com'],
                          ['--restore-save', 'missing.gtop', '--players', '6'],
                          ['--resume', '--players', '6', '7']):
            with self.subTest(arguments=arguments), patch.object(sys, 'argv', [str(SCRIPT), *arguments]), patch.object(adapter, 'request') as request, redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    adapter.main()
                self.assertEqual(error.exception.code, 2)
                request.assert_not_called()


class RestoreTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory)
        args = options(engine_dir=root / 'engine', audit_output=root / 'audits', output=root / 'output',
                       resume=True, started_server=True)
        args.audit_output.mkdir()
        config = adapter.config_for(args, 6)
        stem = adapter.study_stem(config, 6)
        path = args.engine_dir / 'saves' / 'preflop' / (stem + '.gtop')
        path.parent.mkdir(parents=True)
        executable = adapter.engine_executable(args)
        executable.parent.mkdir(parents=True)
        executable.write_bytes(b'synthetic-engine-not-executable')
        header = dict(config=config, iteration=20, multiway_equity_model='coupled_deck_v1',
                      seat_frozen=[False] * 6, seat_profiles=[None] * 6, point_locks=[], hero=None)
        self.write_save(path, header)
        audit = {'engineCommit': adapter.PINNED_COMMIT, 'engineConfig': config,
                 'status': {'iteration': 20, 'published_iteration': 20, 'accuracy_iteration': 20,
                            'state': 'done', 'gap_total': .01, 'stop_reason': 'target_reached'},
                 'elapsedSeconds': 15, 'accuracyCheckpoints': [{'iteration': 20, 'modelGapBb': .01}]}
        audit_path = args.audit_output / (stem + '-heads-up-lines.audit.json')
        audit_path.write_text(json.dumps(audit))
        args.restore_save = path
        return args, config, path, header, audit, audit_path

    def write_save(self, path, header):
        path.write_bytes(b'GTOPREFLOP4\n' + json.dumps(header).encode() + b'\n'
                         + (struct.pack('<Q2f', 2, .25, .75) * 2))

    def test_legacy_save_requires_matching_revision_and_exact_iteration(self):
        with tempfile.TemporaryDirectory() as directory:
            args, config, path, header, audit, audit_path = self.fixture(directory)
            restored = adapter.prepare_restore(args, 6)
            self.assertEqual(restored['save']['iteration'], 20)
            self.assertIn('no historical checksum', restored['origin'])
            for change in ({'engineCommit': 'wrong'}, {'status': {**audit['status'], 'iteration': 19}},
                           {'accuracyCheckpoints': [{'iteration': 21, 'modelGapBb': .01}]},
                           {'elapsedSeconds': float('nan')}):
                audit_path.write_text(json.dumps({**audit, **change}))
                with self.subTest(change=change), self.assertRaises(RuntimeError):
                    adapter.prepare_restore(args, 6)

    def test_save_headers_reject_other_models_constraints_and_truncated_arenas(self):
        with tempfile.TemporaryDirectory() as directory:
            args, config, path, header, _, _ = self.fixture(directory)
            mutations = [dict(multiway_equity_model='legacy_product'), dict(point_locks=[[1, [.5]]]),
                         dict(hero=0), dict(seat_profiles=[{}] + [None] * 5), dict(seat_frozen=[False]),
                         dict(config={**config, 'limp': True}), dict(iteration=-1)]
            for change in mutations:
                self.write_save(path, {**header, **change})
                with self.subTest(change=change), self.assertRaises(RuntimeError):
                    adapter.inspect_save(path, config)
            self.write_save(path, header)
            content = path.read_bytes()
            for invalid in (content[:-1], content + b'extra', b'GTOPREFLOP1\n' + content[12:]):
                path.write_bytes(invalid)
                with self.assertRaises(RuntimeError):
                    adapter.inspect_save(path, config)

    def test_restore_cannot_address_other_directories_or_sanitized_names(self):
        with tempfile.TemporaryDirectory() as directory:
            args, _, path, _, _, _ = self.fixture(directory)
            outside = Path(directory) / path.name
            outside.write_bytes(path.read_bytes())
            args.restore_save = outside
            with self.assertRaises(RuntimeError):
                adapter.prepare_restore(args, 6)
            wrong = path.with_name('computed-6max!.gtop')
            wrong.write_bytes(path.read_bytes())
            args.restore_save = wrong
            with self.assertRaises(RuntimeError):
                adapter.prepare_restore(args, 6)

    def test_checksummed_sidecar_rejects_changed_arena_or_engine_without_legacy_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            args, config, path, _, audit, _ = self.fixture(directory)
            adapter.save_resume_metadata(args, path.stem, config, audit['status'], 15, audit['accuracyCheckpoints'])
            self.assertEqual(adapter.prepare_restore(args, 6)['origin'], 'checksum-sidecar')
            original = path.read_bytes()
            path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                adapter.prepare_restore(args, 6)
            path.write_bytes(original)
            adapter.engine_executable(args).write_bytes(b'other-engine')
            with self.assertRaisesRegex(RuntimeError, 'Compiled engine'):
                adapter.prepare_restore(args, 6)

    def test_restore_export_keeps_old_gap_historical_and_never_rewrites_save(self):
        with tempfile.TemporaryDirectory() as directory:
            args, config, path, _, _, _ = self.fixture(directory)
            args.restore_checkpoint = adapter.prepare_restore(args, 6)
            original = path.read_bytes()
            loaded, calls, exported = False, [], []
            def request(base, endpoint, body=None):
                nonlocal loaded
                calls.append(endpoint)
                if endpoint == 'status':
                    return {'state': 'stopped' if loaded else '', 'iteration': 20 if loaded else 0,
                            'published_iteration': 20 if loaded else 0, 'accuracy_iteration': None, 'gap_total': 0}
                if endpoint == 'estimate': return {'ok': True}
                if endpoint == 'load': loaded = True; return {}
                if endpoint == 'session':
                    return {'config': config, 'iteration': 20, 'multiway_equity_model': 'coupled_deck_v1'}
                self.fail('Unexpected mutating request: ' + endpoint)
            def stream(base, dataset, config, output, stem, max_nodes, max_bytes, scope):
                exported.append(dataset)
                dataset['computation']['coverage'].update({'exportedDecisions': 1, 'allReachableDecisionsExported': False})
                return [], []
            with patch.object(adapter, 'request', request), patch.object(adapter, 'stream_tree_chunks', stream), redirect_stdout(io.StringIO()):
                adapter.run(args, 6)
            self.assertEqual(calls.count('load'), 1)
            self.assertNotIn('save', calls)
            self.assertEqual(path.read_bytes(), original)
            self.assertIsNone(exported[0]['source']['computation']['modelGapBb'])
            self.assertEqual(exported[0]['source']['computation']['status'], 'unconverged')
            audit = exported[0]['computation']
            self.assertEqual(audit['resumedFromIteration'], 20)
            self.assertEqual(audit['accuracyCheckpoints'], [{'iteration': 20, 'modelGapBb': .01}])
            self.assertFalse(audit['solver_quality']['metricAppliesToFinalSnapshot'])
            self.assertEqual(adapter.prepare_restore(args, 6)['origin'], 'checksum-sidecar')

    def test_restore_never_replaces_an_occupied_session_or_changes_since_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            args, _, path, _, _, _ = self.fixture(directory)
            args.restore_checkpoint = adapter.prepare_restore(args, 6)
            for state in ('running', 'stopped', 'done', 'idle'):
                def request(base, endpoint, body=None):
                    if endpoint == 'status': return {'state': state}
                    if endpoint == 'estimate': return {'ok': True}
                    self.fail('Restore must not issue ' + endpoint)
                with self.subTest(state=state), patch.object(adapter, 'request', request), redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                    adapter.run(args, 6)
            original = path.read_bytes()
            path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            def request(base, endpoint, body=None):
                if endpoint == 'status': return {'state': ''}
                if endpoint == 'estimate': return {'ok': True}
                self.fail('Changed save must not be loaded')
            with patch.object(adapter, 'request', request), redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, 'changed after preflight'):
                adapter.run(args, 6)

    def test_live_resume_finds_scoped_audit_and_distinguishes_measured_nonconvergence(self):
        with tempfile.TemporaryDirectory() as directory:
            args, config, _, _, audit, audit_path = self.fixture(directory)
            args.export_only = False
            # Legacy exports may contain a final measured gap without the newer
            # checkpoint array. Retain it as history when another iteration runs.
            del audit['accuracyCheckpoints']
            audit_path.write_text(json.dumps(audit))
            solved, captured = False, []
            def request(base, endpoint, body=None):
                nonlocal solved
                if endpoint == 'status':
                    return {'state': 'done', 'iteration': 21 if solved else 20,
                            'published_iteration': 21 if solved else 20,
                            'accuracy_iteration': 21 if solved else 20,
                            'gap_total': .15 if solved else .01,
                            'target_gap': .02, 'stop_reason': 'iteration_limit' if solved else 'target_reached'}
                if endpoint == 'estimate': return {'ok': True}
                if endpoint == 'session': return {'config': config, 'iteration': 20}
                if endpoint == 'solve': solved = True; return {}
                if endpoint == 'save': return {'iteration': 21}
                self.fail('Unexpected request ' + endpoint)
            def stream(base, dataset, config, output, stem, max_nodes, max_bytes, scope):
                captured.append(dataset)
                dataset['computation']['coverage'].update({'exportedDecisions': 1, 'allReachableDecisionsExported': False})
                return [], []
            with patch.object(adapter, 'request', request), patch.object(adapter, 'stream_tree_chunks', stream), patch.object(adapter, 'save_resume_metadata', return_value={}), redirect_stdout(io.StringIO()):
                adapter.run(args, 6)
            result = captured[0]
            self.assertGreaterEqual(result['computation']['elapsedSeconds'], 15)
            self.assertEqual(result['computation']['accuracyCheckpoints'], [
                {'iteration': 20, 'modelGapBb': .01}, {'iteration': 21, 'modelGapBb': .15}])
            self.assertEqual(result['source']['computation']['modelGapBb'], .15)
            self.assertIn('model target not reached', result['source']['precision'])
            self.assertNotIn('accuracy not established', result['source']['precision'])
            self.assertEqual(result['source']['computation']['status'], 'unconverged')

    def test_capped_four_bet_tree_discloses_excluded_five_bet(self):
        boundary = adapter.tree_boundary(adapter.config_for(options(max_raises=3), 8))
        self.assertIn('Facing the last 4-bet, only Fold/Call', boundary)
        self.assertIn('5-bet and further jam options are excluded', boundary)
        self.assertIn('not established as strategically inferior', boundary)

    def test_restricted_identity_parameters_and_source_disclosure_are_distinct(self):
        ordinary = adapter.config_for(options(limp=True, max_raises=4), 9)
        restricted = adapter.config_for(options(limp=True, max_raises=4, restricted_entry=True), 9)
        self.assertNotIn('restricted_entry_k3_limp1', ordinary)
        self.assertTrue(restricted['restricted_entry_k3_limp1'])
        self.assertNotEqual(adapter.study_stem(ordinary, 9), adapter.study_stem(restricted, 9))
        tree = adapter.tree_parameters(restricted)
        self.assertEqual((tree['model'], tree['maxVoluntaryContributors'], tree['maxUnopenedLimps']),
                         ('restricted-entry-k3-limp1-v1', 3, 1))
        self.assertIn('forced to Fold', adapter.restriction_note(restricted))
        self.assertIn('including contributors that later fold', adapter.restriction_note(restricted))
        self.assertEqual(adapter.restriction_note(ordinary), '')
        with self.assertRaises(RuntimeError):
            adapter.validate_standard_config(ordinary, restricted)
        with self.assertRaises(RuntimeError):
            adapter.validate_standard_config(restricted, ordinary)

    def test_restricted_save_format_and_engine_binary_are_bound_to_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            args, ordinary, path, header, _, _ = self.fixture(directory)
            restricted = {**ordinary, 'restricted_entry_k3_limp1': True}
            with self.assertRaisesRegex(RuntimeError, 'save format'):
                adapter.inspect_save(path, restricted)
            raw = path.read_bytes()
            end = raw.index(b'\n', 12)
            restricted_header = json.loads(raw[12:end])
            restricted_header['config'] = restricted
            path.write_bytes(b'GTOPREFLOP5\n' + json.dumps(restricted_header).encode() + raw[end:])
            self.assertEqual(adapter.inspect_save(path, restricted)['iteration'], 20)
            with self.assertRaisesRegex(RuntimeError, 'save format'):
                adapter.inspect_save(path, ordinary)
            explicit = Path(directory) / 'separate-engine.exe'
            args.engine_binary = explicit
            self.assertEqual(adapter.engine_executable(args), explicit.resolve())

    def test_restricted_run_rejects_old_engine_ignoring_config_before_solving(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            args = options(restricted_entry=True, limp=True, max_raises=4,
                           output=output, audit_output=output / 'audits', export_only=False, started_server=True)
            actual = adapter.config_for(options(limp=True, max_raises=4), 9)
            seen = []
            def request(base, endpoint, body=None):
                seen.append(endpoint)
                if endpoint == 'status': return {'state': ''}
                if endpoint == 'estimate': return {'ok': True}
                if endpoint == 'spot': return {}
                if endpoint == 'session': return {'config': actual}
                self.fail('Unverified engine must never solve, save or export')
            with patch.object(adapter, 'request', request), redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                adapter.run(args, 9)
            self.assertNotIn('solve', seen)

    def test_restricted_payoffs_reject_override_changed_fit_cache_and_missing_old_fingerprints(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            (root / 'cache').mkdir()
            fit = root / 'cache' / 'realization_fit.json'
            fit.write_bytes(b'{"knownPinnedCalibration":true}')
            equity = root / 'cache' / 'preflop_eq169.bin'
            equity.write_bytes(struct.pack('<I', 20000) + bytes(169 * 169 * 4))
            args = options(engine_dir=root, restricted_entry=True)
            with patch.object(adapter.subprocess, 'check_output', return_value=fit.read_bytes()):
                inputs = adapter.restricted_payoff_inputs(args)
                args.restricted_provenance = {'payoffInputs': inputs}
                adapter.verify_restricted_payoffs(args)
                audit = {'restrictedEngine': {'payoffInputs': inputs}}
                config = adapter.config_for(args, 6)
                adapter.validate_restricted_restore_inputs(args, audit, config)
                for broken in ({}, {'restrictedEngine': {}}, {'restrictedEngine': {'payoffInputs': {**inputs, 'equityCacheSha256': 'other'}}}):
                    with self.subTest(audit=broken), self.assertRaisesRegex(RuntimeError, 'fingerprints'):
                        adapter.validate_restricted_restore_inputs(args, broken, config)
                with patch.dict(os.environ, {'REALIZATION_FIT': 'different-valid-fit.json'}), self.assertRaisesRegex(RuntimeError, 'overrides'):
                    adapter.restricted_payoff_inputs(args)
                fit.write_bytes(b'{"differentButValid":true}')
                with self.assertRaisesRegex(RuntimeError, 'pinned default'):
                    adapter.restricted_payoff_inputs(args)
                fit.write_bytes(b'{"knownPinnedCalibration":true}')
                # Same sample header, byte length, config and binary; altered
                # equity values must still invalidate the continuation model.
                changed = bytearray(equity.read_bytes()); changed[7] = 1; equity.write_bytes(changed)
                with self.assertRaisesRegex(RuntimeError, 'changed during'):
                    adapter.verify_restricted_payoffs(args)

    def test_restricted_first_cache_is_bound_after_generation_but_never_rebound(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            root=Path(directory); (root/'cache').mkdir()
            (root/'cache'/'realization_fit.json').write_bytes(b'{}')
            args=options(engine_dir=root,restricted_entry=True)
            with patch.object(adapter.subprocess,'check_output',return_value=b'{}'):
                initial=adapter.restricted_payoff_inputs(args,allow_missing_equity=True)
                self.assertIsNone(initial['equityCacheSha256'])
                args.restricted_provenance={'payoffInputs':initial}
                with self.assertRaisesRegex(RuntimeError,'missing'):
                    adapter.verify_restricted_payoffs(args)
                (root/'cache'/'preflop_eq169.bin').write_bytes(struct.pack('<I',20000)+bytes(169*169*4))
                adapter.verify_restricted_payoffs(args,allow_initial_cache=True)
                self.assertIsNotNone(args.restricted_provenance['payoffInputs']['equityCacheSha256'])
                adapter.verify_restricted_payoffs(args)

    def test_restricted_live_server_is_rejected_before_any_http_or_model_assumption(self):
        args=options(restricted_entry=True,started_server=False)
        with patch.object(adapter,'request') as request, self.assertRaisesRegex(RuntimeError,'fresh dedicated'):
            adapter.run(args,9)
        request.assert_not_called()

    def test_restricted_cleanup_only_owns_its_popen_and_bounds_shutdown_wait(self):
        process=Mock(); process.poll.return_value=None
        adapter.cleanup_owned_restricted_process(options(), process)
        process.terminate.assert_not_called()
        adapter.cleanup_owned_restricted_process(options(restricted_entry=True), None)
        adapter.cleanup_owned_restricted_process(options(restricted_entry=True), process)
        process.terminate.assert_called_once(); process.wait.assert_called_once_with(timeout=2)
        process.kill.assert_not_called()
        process.reset_mock(); process.poll.return_value=0
        adapter.cleanup_owned_restricted_process(options(restricted_entry=True), process)
        process.terminate.assert_not_called()
        process.poll.return_value=None
        process.wait.side_effect=[adapter.subprocess.TimeoutExpired('owned-engine',2),0]
        adapter.cleanup_owned_restricted_process(options(restricted_entry=True), process)
        process.kill.assert_called_once()

    def test_restricted_main_cleans_created_engine_on_success_and_failure(self):
        for failure in (False, True):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); binary=root/'engine.exe'; binary.write_bytes(b'fixture')
                process=Mock(pid=123);process.poll.return_value=None
                argv=['solver','--players','6','--restricted-entry','--limp','--max-raises','4',
                      '--start-server','--engine-dir',str(root),'--engine-binary',str(binary),
                      '--threads','1','--output',str(root/'output')]
                def fake_request(*args,**kwargs):
                    if kwargs.get('timeout')==2: raise adapter.urllib.error.URLError('absent')
                    return {}
                with patch.object(sys,'argv',argv), patch.object(adapter,'restricted_provenance',return_value={}), \
                     patch.object(adapter.subprocess,'check_output',return_value=adapter.PINNED_COMMIT), \
                     patch.object(adapter.subprocess,'Popen',return_value=process), \
                     patch.object(adapter,'request',fake_request), \
                     patch.object(adapter,'run',side_effect=RuntimeError('synthetic solve failure') if failure else None):
                    if failure:
                        with self.assertRaisesRegex(RuntimeError,'synthetic solve failure'): adapter.main()
                    else: adapter.main()
                process.terminate.assert_called_once();process.wait.assert_called_once_with(timeout=2)


if __name__ == '__main__':
    unittest.main()
