"""Conservatively transcribe 6/9-max Facing 3-Bet source charts.

Every available hand must agree across two disjoint three-row bands, a four-patch
half-cell check, and independent RGB-distance / HSV classifiers. Bars too thin
for those checks remain unreadable. Bar height never becomes historical reach.
Only the publisher's documented 0/50/100% action precision is reproduced.
Source PDFs and derived data stay in the ignored personal research directory.
"""
from __future__ import annotations

import argparse
from collections import Counter
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIRECTORY = ROOT / 'data/private/research'
RANKS = 'AKQJT98765432'
NAMES = ['raise', 'call', 'fold', 'shove']
PALETTE = np.array([[227, 130, 20], [64, 145, 108], [39, 125, 161], [164, 22, 26]], dtype=np.int32)
SOURCES = {
    6: {
        'name': 'RangeConverter', 'title': '6-max 100bb 100z',
        'url': 'https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash',
        'sha256': '60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967',
    },
    9: {
        'name': 'RangeConverter', 'title': '9-max 100bb live cash',
        'url': 'https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash',
        'sha256': '0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27',
    },
}

# These sizes are transcribed individually from native PDF image legends, not
# derived from opponent position. The reviewed 9-max p11 UTG vs SB legend says
# 26 BB, despite the older RESPONSE_DATA_GAPS note saying 28 BB.
# Each row is page, hero, [(opponent, printed 4-bet-to size), ...] in reading order.
MANIFEST = {
    6: [
        (9, 'UTG', [('HJ', 23.62), ('CO', 23.62), ('BTN', 23.8), ('SB', 25.04), ('BB', 25.01)]),
        (10, 'HJ', [('CO', 23.8), ('BTN', 23.62), ('SB', 25.04), ('BB', 25.01)]),
        (11, 'CO', [('BTN', 23.62), ('SB', 25.04), ('BB', 25.01)]),
        (12, 'BTN', [('SB', 25.04), ('BB', 25.01)]),
        (13, 'SB', [('BB', 27.06)]),
    ],
    9: [
        (11, 'UTG', [('UTG+1', 26), ('UTG+2', 26), ('LJ', 26), ('HJ', 26), ('CO', 26), ('BTN', 26), ('SB', 26), ('BB', 28)]),
        (12, 'UTG+1', [('UTG+2', 26), ('LJ', 26), ('HJ', 26), ('CO', 26), ('BTN', 26), ('SB', 26), ('BB', 28)]),
        (13, 'UTG+2', [('LJ', 26), ('HJ', 26), ('CO', 26), ('BTN', 26), ('SB', 26), ('BB', 28)]),
        (14, 'LJ', [('HJ', 26), ('CO', 26), ('BTN', 26), ('SB', 26), ('BB', 28)]),
        (15, 'HJ', [('CO', 26), ('BTN', 26), ('SB', 26), ('BB', 28)]),
        (16, 'CO', [('BTN', 26), ('SB', 26), ('BB', 28)]),
        (17, 'BTN', [('SB', 26), ('BB', 28)]),
        (18, 'SB', [('BB', 28)]),
    ],
}
PRECISION = 'Publisher simplified to 0 / 50 / 100%; verified visible action colors only. Thin or ambiguous bars remain unknown; historical reach is not reconstructed.'


def rgb_labels(image):
    pixels = np.asarray(image.convert('RGB'), dtype=np.int32)
    distances = ((pixels[:, :, None, :] - PALETTE[None, None, :, :]) ** 2).sum(axis=3)
    labels = distances.argmin(axis=2)
    labels[distances.min(axis=2) > 2000] = -1
    return labels


def hsv_labels(image):
    # Independent color classifier; no nearest-palette distances are reused.
    pixels = np.asarray(image.convert('HSV'))
    hue, saturation, value = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    labels = np.full(hue.shape, -1, dtype=np.int32)
    chromatic = (saturation > 100) & (value > 75)
    for index, selection in enumerate(((hue >= 12) & (hue < 40), (hue >= 90) & (hue < 125), (hue >= 125) & (hue < 165), (hue < 12) | (hue > 240))):
        labels[chromatic & selection] = index
    return labels


def grid_box(players, page, index, labels):
    special = players == 9 and page == 11
    x = ([2, 533, 1062, 1594] if special else [0, 516, 1031, 1547])[index % 4]
    expected_y = 40 if index < 4 else 653 if special else 703
    width, height = (451, 496) if special else (498, 546)
    # The lower image row has a small per-page vertical offset. Use the earliest
    # solid background among AA/AKs/AQs (visually reviewed to include a full-height
    # cell in each chart). AA alone is NOT safe: SB's opening range includes limps.
    anchors = [round(x + (column + 0.25) * width / 13) for column in range(3)]
    candidates = [y for y in range(expected_y - 15, expected_y + 16)
                  if any(np.all(labels[y:y + 6, anchor - 1:anchor + 2] >= 0) for anchor in anchors)]
    if not candidates:
        raise ValueError(f'Cannot locate source grid at {players}-max page {page} chart {index + 1}.')
    y = candidates[0]
    return [x, y, width, height]


def hand_name(row, col):
    return RANKS[row] * 2 if row == col else RANKS[min(row, col)] + RANKS[max(row, col)] + ('s' if row < col else 'o')


def quantize_band(labels, cell, rows, action_ids):
    x0, _, x1, _ = cell
    band = labels[rows, x0 + 2:x1 - 2]
    counts = Counter(int(value) for value in band.flat if value >= 0)
    total = sum(counts.values())
    if total < band.size * 0.9:
        raise ValueError('Less than 90% of the independent band has recognizable action color.')
    proportions = {key: counts.get(index, 0) / total for index, key in enumerate(NAMES)}
    frequencies = {key: round(value * 2) / 2 for key, value in proportions.items()}
    if any(abs(proportions[key] - frequencies[key]) > 0.065 for key in proportions):
        raise ValueError('Visible action widths do not independently support 50% steps.')
    if sum(frequencies.values()) != 1 or any(value > 0 and key not in action_ids for key, value in frequencies.items()):
        raise ValueError('Visible actions disagree with the source legend.')
    return {key: frequencies[key] for key in action_ids}


def read_hand(labels, alternate, cell, action_ids):
    x0, y0, x1, y1 = cell
    # White/blue label antialiasing can resemble a few isolated Fold pixels.
    # Look for a horizontal 3-pixel color run outside the central label region.
    # A one-row action stripe is still detected here, but fails band verification.
    edge_rows = max(3, (y1 - y0) // 5)
    edges = np.concatenate((labels[y0:y0 + edge_rows, x0 + 2:x1 - 2], labels[y1 - edge_rows:y1, x0 + 2:x1 - 2]))
    color_runs = (edges[:, :-2] >= 0) & (edges[:, :-2] == edges[:, 1:-1]) & (edges[:, 1:-1] == edges[:, 2:])
    if not np.any(color_runs):
        return {'status': 'not-charted'}, 'No recognizable action-color run outside the text region; no zero-reach claim.'
    quarter_x = [round(x0 + (x1 - x0) * fraction) for fraction in (0.2, 0.3, 0.7, 0.8)]
    candidate_rows = []
    for y in range(y0 + 2, y1 - 2):
        patches = [labels[y, x - 1:x + 2] for x in quarter_x]
        if all(np.all(patch >= 0) and np.all(patch == patch[0]) for patch in patches) and patches[0][0] == patches[1][0] and patches[2][0] == patches[3][0]:
            candidate_rows.append(y)
    starts = [y for y in candidate_rows if y + 1 in candidate_rows and y + 2 in candidate_rows]
    # Two non-overlapping 3-row bands with a gap need at least seven reliable rows.
    if not starts or starts[-1] < starts[0] + 4:
        return {'status': 'unreadable'}, 'Colored bar too thin for two independent three-row bands.'
    bands = [list(range(starts[0], starts[0] + 3)), list(range(starts[-1], starts[-1] + 3))]
    try:
        results = [quantize_band(classifier, cell, band, action_ids) for classifier in (labels, alternate) for band in bands]
        if any(result != results[0] for result in results):
            raise ValueError('Independent RGB/HSV scan bands disagree.')
        # Half-cell patches verify the same 0/50/100 assignment independently.
        for band in bands:
            for y in band:
                halves = [int(labels[y, quarter_x[0]]), int(labels[y, quarter_x[2]])]
                expected = {key: sum(NAMES[value] == key for value in halves) / 2 for key in action_ids}
                if expected != results[0]:
                    raise ValueError('Half-cell patches disagree with full band proportions.')
        return {'status': 'available', 'frequencies': results[0], 'verification': {'cellBox': cell, 'independentRows': bands, 'classifiers': ['RGB-distance', 'HSV'], 'historicalReach': None}}, None
    except ValueError as error:
        return {'status': 'unreadable'}, str(error)


def actions(players, size):
    result = [{'id': 'raise', 'label': f'4-Bet {size:g} BB', 'type': 'raise', 'amountBb': size}]
    if players == 9:
        result.append({'id': 'shove', 'label': 'All-in 100 BB', 'type': 'raise', 'amountBb': 100})
    result.extend([{'id': 'call', 'label': 'Call', 'type': 'call'}, {'id': 'fold', 'label': 'Fold', 'type': 'fold'}])
    return result


def verify_reader():
    """Regression checks for mixed actions, faint strips and text-color leakage."""
    def read(pixels, wrong_alternate=False):
        image = Image.fromarray(pixels.astype(np.uint8))
        labels, alternate = rgb_labels(image), hsv_labels(image)
        if wrong_alternate:
            alternate[alternate == 0] = 2
        return read_hand(labels, alternate, [0, 0, 40, 42], NAMES)[0]
    pixels = np.zeros((42, 40, 3), dtype=np.uint8)
    pixels[:] = PALETTE[0]
    assert read(pixels)['frequencies']['raise'] == 1
    pixels[:, 20:] = PALETTE[1]
    assert read(pixels)['frequencies'] == {'raise': 0.5, 'call': 0.5, 'fold': 0.0, 'shove': 0.0}
    assert read(pixels, True)['status'] == 'unreadable'
    pixels[:, 10:] = PALETTE[1]
    assert read(pixels)['status'] == 'unreadable'  # Cannot pass a 25/75 split as 50/50.
    pixels[:] = (18, 38, 60)
    assert read(pixels)['status'] == 'not-charted'
    pixels[19:23, 14:27] = PALETTE[2]
    assert read(pixels)['status'] == 'not-charted'  # A colored label is not an action.
    pixels[:] = (18, 38, 60)
    pixels[39:40] = PALETTE[1]
    assert read(pixels)['status'] == 'unreadable'
    pixels[32:40] = PALETTE[1]
    assert read(pixels)['frequencies']['call'] == 1


def verify_source_examples(players, nodes):
    """Manually checked source crops exercise conditional reach and separate shove."""
    by_spot = {(node['hero'], node['villain']): node for node in nodes}
    examples = ([('UTG', 'HJ', 'AA', {'raise': 1}), ('UTG', 'HJ', 'AQs', {'raise': 0.5, 'call': 0.5}),
                 ('UTG', 'HJ', '66', {'call': 0.5, 'fold': 0.5}), ('SB', 'BB', 'AA', {'raise': 1}),
                 ('SB', 'BB', 'AQo', {'raise': 0.5, 'call': 0.5})] if players == 6 else
                [('UTG', 'UTG+1', 'AA', {'raise': 1}), ('UTG', 'UTG+1', 'AQs', {'call': 0.5, 'fold': 0.5}),
                 ('SB', 'BB', 'AQo', {'shove': 0.5, 'call': 0.5})])
    for hero, villain, hand, expected in examples:
        actual = by_spot[hero, villain]['hands'][hand]
        assert actual['status'] == 'available', (players, hero, villain, hand, actual)
        assert {key: value for key, value in actual['frequencies'].items() if value} == expected, (players, hero, villain, hand, actual)
    if players == 6:
        assert by_spot['UTG', 'HJ']['hands']['55']['status'] == 'unreadable'
    else:
        assert by_spot['UTG', 'SB']['actions'][0]['amountBb'] == 26


def transcribe(players, directory):
    source = SOURCES[players]
    raw = (directory / f'rangeconverter-{players}max-100bb.pdf').read_bytes()
    if sha256(raw).hexdigest() != source['sha256']:
        raise ValueError('Source PDF hash differs. Re-review all headings, legends and coordinates before transcribing.')
    reader = PdfReader(BytesIO(raw))
    nodes, failures, geometry = [], {}, []
    for page, hero, opponents in MANIFEST[players]:
        original = reader.pages[page - 1]
        if len(original.images) != 1 or original.images[0].image.size != (2048, 1313):
            raise ValueError('Unexpected native image layout.')
        image = original.images[0].image.convert('RGB')
        labels, alternate = rgb_labels(image), hsv_labels(image)
        for index, (villain, size) in enumerate(opponents):
            x, y, width, height = box = grid_box(players, page, index, labels)
            node_actions = actions(players, size)
            action_ids = [action['id'] for action in node_actions]
            hands, errors = {}, {}
            for row in range(13):
                for col in range(13):
                    cell = [round(x + col * width / 13), round(y + row * height / 13), round(x + (col + 1) * width / 13), round(y + (row + 1) * height / 13)]
                    hand = hand_name(row, col)
                    hands[hand], reason = read_hand(labels, alternate, cell, action_ids)
                    if reason:
                        errors[hand] = reason
            node_id = f'rangeconverter-{players}max-100bb-vs-3bet-{hero}-{villain}'.lower().replace('+', 'plus')
            nodes.append({
                'id': node_id, 'refId': f'rangeconverter-{players}max-100bb', 'players': players, 'stackBb': 100,
                'kind': 'vs-3bet', 'hero': hero, 'villain': villain, 'page': page, 'chart': index + 1,
                'actions': node_actions, 'hands': hands, 'precision': PRECISION,
                'notes': [
                    'Hero opened, the named opponent 3-bet, and all other players folded. Verify the preceding bet sizes in the source; no cold callers or squeeze.',
                    'Only the visible conditional action colors are transcribed. Vertical bar height does not reconstruct historical reach.',
                    'Dark/gray cells are not-charted; thin or ambiguous colored bars are unreadable. Neither status implies Fold or mathematically zero reach.',
                    'Each readable hand passed two disjoint three-row bands, half-cell patches, and independent RGB/HSV classifiers.',
                    'No node aggregate is calculated because the exact reaching range is unknown. More complete strategy requires matching rake, ante, full history and solver conditions.',
                    'Fixed 4-bet and All-in are separate actions; sizes were read individually from the verified PDF legend.' if players == 9 else 'The fixed 4-bet size was read individually from the verified PDF legend; no undeclared All-in action is added.',
                ],
                'verification': {'nativeImageSize': list(image.size), 'gridBox': box, 'sourceSha256': source['sha256'], 'legendReview': 'Enlarged native title/legend contact sheet, 2026-10-02', 'historicalReach': None},
            })
            failures[node_id] = errors
            geometry.append({'page': page, 'chart': index + 1, 'hero': hero, 'villain': villain, 'gridBox': box})
        print(f'{players}-max page {page}: {len(opponents)} charts inspected', flush=True)
    expected = 15 if players == 6 else 36
    if len(nodes) != expected:
        raise ValueError('Incomplete source manifest.')
    verify_source_examples(players, nodes)
    output = directory / f'derived-rangeconverter-{players}max-later.json'
    payload = {'schemaVersion': 1, 'kind': 'reference-ranges', 'preparedAt': '2026-10-02', 'source': source, 'nodes': nodes}
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    report = {'sourceSha256': source['sha256'], 'outputSha256': sha256(output.read_bytes()).hexdigest(), 'players': players, 'charts': len(nodes), 'handStates': dict(Counter(hand['status'] for node in nodes for hand in node['hands'].values())), 'geometry': geometry, 'unavailableHands': failures}
    (directory / f'rangeconverter-{players}max-later-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in ('geometry', 'unavailableHands')}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument('--self-test', action='store_true', help='Run synthetic reader checks without loading any private PDFs.')
    args = parser.parse_args()
    verify_reader()
    if args.self_test:
        print('Conservative transcription reader checks passed.')
        return
    directory = args.directory.expanduser().resolve()
    for players in (6, 9):
        transcribe(players, directory)


if __name__ == '__main__':
    main()
