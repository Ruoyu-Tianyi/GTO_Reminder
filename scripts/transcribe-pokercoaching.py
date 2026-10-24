"""Measure published PokerCoaching image bars; never claim solver precision.

Source images are 1080 x 693 pixels. Two disjoint horizontal bands independently
measure every cell; a discrepancy marks the hand unreadable instead of guessing.
Black cells remain not-charted. All originals and output stay in data/private.
Requires pypdf, Pillow, and numpy. Run from any directory with Python 3.10+.
"""
from __future__ import annotations

import argparse
from collections import Counter
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re

import numpy as np
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIRECTORY = ROOT / 'data/private/research'
SOURCE_SHA256 = '2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9'
SOURCE = {
    'name': 'PokerCoaching', 'title': 'The Ultimate Cash Game Preflop Guide 2026',
    'url': 'https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf',
    'sha256': SOURCE_SHA256,
}
RANKS = 'AKQJT98765432'
SEAT = r'UTG\+1|UTG|LJ|HJ|CO|BTN|SB|BB'
HEADING = re.compile(rf'({SEAT})(?: vs ({SEAT}))? · (RFI|3-Bet|4-Bet|5-Bet All-In|Limp)')
PAGES = [4, 5, *range(8, 28)]
# All headings were checked in separately enlarged title crops. In whole-page
# thumbnails the second B can resemble S; pages 17, 24, 26 are NOT ambiguous.
EXCLUDED = {}
PALETTE = np.array([[240, 59, 59], [86, 185, 100], [60, 124, 185], [95, 22, 17], [0, 0, 0]], dtype=np.int32)
COLOR_NAMES = ['raise', 'call', 'fold', 'shove', 'black']
PRECISION = ('Image-bar measurement rounded to 1 percentage point; approximate ±2 percentage points. '
             'Subpixel actions may be invisible. Original solver frequencies and rounding are not disclosed.')
# Independent checks transcribed from the visible legend totals. They are NOT
# used to adjust any hand and are only valid for full-range RFI / vs-open grids.
PRINTED_TOTALS = {
    4: [(11.38, 0), (13.22, 0), (15.69, 0), (19.60, 0), (26.14, 0), (40.28, 0)],
    5: [(9.84, 64.12)],
    8: [(3.53, 3.82), (3.74, 4.17), (3.89, 4.69), (3.94, 5.71), (4.16, 7.23), (4, 2.79)],
    9: [(3.65, 11.37), (4.32, 4.07), (4.41, 5.09), (4.58, 6.06), (4.80, 7.29), (4.59, 3.15)],
    10: [(4.31, 12.51), (5.20, 4.90), (5.35, 5.98), (5.57, 7.75), (5.41, 4.05), (5.26, 14.39)],
    11: [(6.34, 5.99), (6.63, 8.92), (6.81, 3.26), (6.75, 16.48), (8.58, 9.71), (8.84, 3.57)],
    12: [(8.76, 19.60), (12.49, 4.51), (12.75, 25.49), (10.49, 35.66), (33.03, 66.97)],
}


def hand_name(row, col):
    if row == col:
        return RANKS[row] * 2
    return RANKS[min(row, col)] + RANKS[max(row, col)] + ('s' if row < col else 'o')


def classify(image, allowed=None):
    pixels = np.asarray(image.convert('RGB'), dtype=np.int32)
    distances = ((pixels[:, :, None, :] - PALETTE[None, None, :, :]) ** 2).sum(axis=3)
    if allowed is not None:
        for index, color in enumerate(COLOR_NAMES):
            if color != 'black' and color not in allowed:
                distances[:, :, index] = 1_000_000
    labels = distances.argmin(axis=2)
    labels[distances.min(axis=2) > 4200] = -1
    return labels


def read_band(labels, row, col, offsets):
    # The source image is NOT divided into 13 equal-width tiles: colored cells
    # are 80 px wide on an 83 1/3 px pitch, with 3 px separators. Dividing the
    # entire 1080 px width by 13 leaks the previous cell into the last columns.
    x0 = round(col * 250 / 3)
    x1 = x0 + 80
    y0 = 82 + row * 47
    band = labels[[y0 + dy for dy in offsets], x0:x1]
    # A black cell has no strategic recommendation. Text/borders do not change it.
    if np.mean(band == 4) > 0.9:
        return None
    columns = []
    for index in range(band.shape[1]):
        votes = Counter(int(v) for v in band[:, index] if 0 <= v < 4)
        columns.append(votes.most_common(1)[0][0] if votes else -1)
    valid = [i for i, v in enumerate(columns) if v >= 0]
    if len(valid) < len(columns) * 0.85:
        raise ValueError('Insufficient colored background')
    # Fill only border/antialias holes, using the nearest classified column.
    for i, v in enumerate(columns):
        if v < 0:
            nearest = min(valid, key=lambda j: abs(j - i))
            # Rounded outer corners and the separator can occupy up to 7 px.
            # Interior holes must be shorter to avoid bridging unreadable bars.
            allowance = 7 if i < valid[0] or i > valid[-1] else 4
            if abs(nearest - i) > allowance:
                raise ValueError('Ambiguous gap inside colored cell')
            columns[i] = columns[nearest]
    counts = Counter(columns)
    return {COLOR_NAMES[k]: counts[k] / len(columns) for k in range(4)}


def quantize(values):
    scaled = {key: val * 100 for key, val in values.items()}
    units = {key: int(np.floor(value)) for key, value in scaled.items()}
    remainder = 100 - sum(units.values())
    for key in sorted(scaled, key=lambda key: scaled[key] - units[key], reverse=True)[:remainder]:
        units[key] += 1
    return {key: value / 100 for key, value in units.items()}


def action_definitions(kind, hero, villain):
    def action(id_, label, type_, amount=None):
        result = {'id': id_, 'label': label, 'type': type_}
        if amount is not None:
            result['amountBb'] = amount
        return result
    call = action('call', 'Limp / complete (source: Call)' if kind == 'rfi' else 'Call', 'call')
    fold = action('fold', 'Fold', 'fold')
    shove = action('shove', 'All-in 100 BB', 'raise', 100)
    if kind == 'rfi':
        size = 4 if hero == 'SB' else 3
        return [action('raise', f'Raise {size} BB', 'raise', size), *([call] if hero == 'SB' else []), fold]
    if kind == 'vs-open':
        size = 12 if hero in ('SB', 'BB') else 10
        return [action('raise', f'Raise {size} BB', 'raise', size), call, fold]
    if kind == 'vs-limp':
        return [action('raise', 'Raise 4 BB', 'raise', 4), action('check', 'Check (source: Call)', 'check')]
    if kind == 'vs-3bet':
        size = 28.8 if hero == 'SB' else 27 if villain in ('SB', 'BB') else 24
        return [shove, action('raise', f'Raise {size} BB', 'raise', size), call, fold]
    if kind == 'vs-4bet':
        return [shove, call, fold]
    if kind == 'vs-5bet':
        return [call, fold]
    raise ValueError(f'Unknown kind {kind}')


def extract_node(image, page, chart, hero, villain, suffix):
    kind = {'3-Bet': 'vs-3bet', '4-Bet': 'vs-4bet', '5-Bet All-In': 'vs-5bet', 'Limp': 'vs-limp'}.get(suffix, 'vs-open' if villain else 'rfi')
    actions = action_definitions(kind, hero, villain)
    action_ids = {action['id'] for action in actions}
    labels = classify(image, action_ids | ({'call'} if kind == 'vs-limp' else set()))
    hands = {}
    disagreements = []
    for row in range(13):
        for col in range(13):
            hand = hand_name(row, col)
            try:
                top = read_band(labels, row, col, (8, 9, 10))
                bottom = read_band(labels, row, col, (36, 37, 38))
                if top is None and bottom is None:
                    hands[hand] = {'status': 'not-charted'}
                    continue
                if top is None or bottom is None:
                    raise ValueError('Colored/black disagreement between bands')
                difference = max(abs(top[key] - bottom[key]) for key in top)
                if difference > 0.025:
                    raise ValueError(f'Independent bands differ by {difference:.3f}')
                values = {key: (top[key] + bottom[key]) / 2 for key in top}
                if kind == 'vs-limp':
                    values['check'] = values.pop('call')
                unexpected = {key: value for key, value in values.items() if key not in action_ids and value > 0}
                if unexpected:
                    raise ValueError(f'Undeclared action color: {unexpected}')
                values = quantize({key: values[key] for key in [action['id'] for action in actions]})
                hands[hand] = {'status': 'available', 'frequencies': values}
            except ValueError as error:
                hands[hand] = {'status': 'unreadable'}
                disagreements.append(f'{hand}: {error}')
    notes = [
        'Only the source position/action sequence is represented; verify preceding sizes in the PDF. Rake, ante and convergence are not disclosed.',
        'Black source cells are not-charted, never 100% Fold. No reach-weighted range aggregate is reconstructed.',
    ]
    if kind == 'rfi' and hero == 'SB':
        notes.append('The unopened SB source labels its passive completion Call; this is a Limp.')
    if kind == 'vs-limp':
        notes.append('BB faces an SB completion to 1 BB; the source labels the free passive action Call, interpreted as Check.')
    if disagreements:
        notes.append(f'{len(disagreements)} hands failed independent scan-band verification and remain unreadable.')
    return {
        'id': f'pokercoaching-8max-100bb-{kind}-{hero}-{villain or "none"}'.lower().replace('+', 'plus'),
        'refId': 'pokercoaching-8max-100bb', 'players': 8, 'stackBb': 100,
        'kind': kind, 'hero': hero, 'villain': villain or None, 'page': page, 'chart': chart,
        'actions': actions, 'hands': hands, 'notes': notes, 'precision': PRECISION,
    }, disagreements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    raw = (args.directory / 'pokercoaching-ultimate-cash.pdf').read_bytes()
    if sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('Source PDF hash differs; re-review coordinates and all headings before transcribing.')
    pdf = PdfReader(BytesIO(raw))
    nodes, failures = [], {}
    for page in PAGES:
        original = pdf.pages[page - 1]
        headings = HEADING.findall(original.extract_text())
        images = []
        for entry in original.images:
            image = entry.image
            if image.size == (1080, 693):
                images.append(image.convert('RGB'))
        if len(headings) != len(images):
            raise ValueError(f'Page {page}: heading/image count mismatch')
        for index, ((hero, villain, suffix), image) in enumerate(zip(headings, images), 1):
            if (page, index) in EXCLUDED:
                continue
            node, errors = extract_node(image, page, index, hero, villain, suffix)
            nodes.append(node)
            if errors:
                failures[node['id']] = errors
        print(f'Page {page}: {len(headings)} image charts inspected', flush=True)
    expected = {'rfi': 7, 'vs-open': 28, 'vs-3bet': 28, 'vs-4bet': 28, 'vs-limp': 1, 'vs-5bet': 27}
    if dict(Counter(node['kind'] for node in nodes)) != expected:
        raise ValueError('Unexpected source coverage')
    legend_checks = []
    for node in nodes:
        if node['page'] not in PRINTED_TOTALS:
            continue
        if not all(hand['status'] == 'available' for hand in node['hands'].values()):
            raise ValueError('A full-range opening chart contains unreadable/absent cells')
        for action, printed in zip(['raise', 'check' if node['kind'] == 'vs-limp' else 'call'], PRINTED_TOTALS[node['page']][node['chart'] - 1]):
            measured = sum((6 if len(hand) == 2 else 4 if hand.endswith('s') else 12) * value['frequencies'].get(action, 0) / 1326 * 100 for hand, value in node['hands'].items())
            discrepancy = abs(measured - printed)
            if discrepancy > 0.35:
                raise ValueError(f'{node["id"]} {action}: printed/measured totals disagree by {discrepancy:.3f} percentage points')
            legend_checks.append({'id': node['id'], 'action': action, 'printedPercent': printed,
                                  'measuredPercent': round(measured, 4), 'differencePercentagePoints': round(discrepancy, 4)})
    result = {'schemaVersion': 1, 'kind': 'reference-ranges', 'preparedAt': '2026-10-02', 'source': SOURCE, 'nodes': nodes}
    output = args.directory / 'derived-pokercoaching-ranges.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = {
        'sourceSha256': SOURCE_SHA256, 'outputSha256': sha256(output.read_bytes()).hexdigest(),
        'charts': len(nodes), 'byKind': expected,
        'handStates': dict(Counter(hand['status'] for node in nodes for hand in node['hands'].values())),
        'excludedCharts': [{'page': p, 'chart': c, 'reason': reason} for (p, c), reason in EXCLUDED.items()],
        'independentPrintedLegendChecks': legend_checks,
        'unreadableHands': failures,
    }
    (args.directory / 'pokercoaching-transcription-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('unreadableHands', 'independentPrintedLegendChecks')}, indent=2))
    print(f'{len(legend_checks)} independent legend-total checks passed; max discrepancy '
          f'{max(check["differencePercentagePoints"] for check in legend_checks):.4f} percentage points.')


if __name__ == '__main__':
    main()
