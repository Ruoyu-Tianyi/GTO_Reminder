"""Transcribe reviewed 50%-step Facing Open diagrams, never solver precision.

Both input fingerprints are checked before parsing. Unknown chart colors are
errors, never Fold. The existing RFI script and artifact are not modified.
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from pypdf import PdfReader

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[1] / 'data' / 'private' / 'research'
EXPECTED_OUTPUT_SHA256 = 'a87eedd66e38864152f6c969e7cc3f7c58f3481bfdd2388c452b445f1f144d25'
RANKS = 'AKQJT98765432'
PALETTE = {'raise': (227, 130, 20), 'call': (64, 145, 108), 'fold': (39, 125, 161)}
SOURCES = [
    {
        'id': 'rangeconverter-6max-100bb-100z', 'refId': 'rangeconverter-6max-100bb',
        'file': 'rangeconverter-6max-100bb.pdf', 'players': 6,
        'title': '6-max 100bb 100z', 'pages': [4, 5, 6, 7, 8],
        'sha256': '60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967',
        'url': 'https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash',
    },
    {
        'id': 'rangeconverter-9max-100bb', 'refId': 'rangeconverter-9max-100bb',
        'file': 'rangeconverter-9max-100bb.pdf', 'players': 9,
        'title': '9-max 100bb live cash', 'pages': [4, 5, 6, 7, 8, 9, 10],
        'sha256': '0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27',
        'url': 'https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash',
    },
]

# Each row: hero, original raiser, raise-to BB, printed raise %, printed call %.
# None means the source does not print the value, not a zero frequency.
PAGES = [
    (6, 4, [('HJ', 'UTG', 8.48, 8.07, None)]),
    (6, 5, [('CO', 'UTG', 8.48, 8.47, None), ('CO', 'HJ', 8.48, 10.01, None)]),
    (6, 6, [('BTN', 'UTG', 8.48, 8.14, 3.39), ('BTN', 'HJ', 8.48, 10.08, 2.29), ('BTN', 'CO', 8.48, 13.7, 0.61)]),
    (6, 7, [('SB', 'UTG', 10.9, 7.44, None), ('SB', 'HJ', 10.9, 8.77, None), ('SB', 'CO', 10.9, 10.91, None), ('SB', 'BTN', 10.9, 15.24, None)]),
    (6, 8, [('BB', 'UTG', 11.03, 6.13, 19.27), ('BB', 'HJ', 11.03, 7.56, 20.72), ('BB', 'CO', 11.03, 9.46, 22.61), ('BB', 'BTN', 11.03, 14.42, 26.55), ('BB', 'SB', 10.02, 15.67, 40.39)]),
    (9, 4, [('UTG+1', 'UTG', 10, 3.78, 1.44), ('UTG+2', 'UTG', 10, 3.82, 1.91), ('UTG+2', 'UTG+1', 10, 4.26, 2.09)]),
    (9, 5, [('LJ', 'UTG', 10, 3.83, 2.62), ('LJ', 'UTG+1', 10, 4.3, 2.74), ('LJ', 'UTG+2', 10, 4.75, 2.76)]),
    (9, 6, [('HJ', 'UTG', 10, 3.88, 3.53), ('HJ', 'UTG+1', 10, 4.35, 3.62), ('HJ', 'UTG+2', 10, 4.83, 3.65), ('HJ', 'LJ', 10, 5.75, 3.33)]),
    (9, 7, [('CO', 'UTG', 10, 3.85, 4.95), ('CO', 'UTG+1', 10, 4.35, 4.97), ('CO', 'UTG+2', 10, 4.85, 5.32), ('CO', 'LJ', 10, 5.76, 5.06), ('CO', 'HJ', 10, 6.84, 4.76)]),
    (9, 8, [('BTN', 'UTG', 10, 3.74, 7.01), ('BTN', 'UTG+1', 10, 4.38, 6.98), ('BTN', 'UTG+2', 10, 4.89, 7.7), ('BTN', 'LJ', 10, 5.65, 7.76), ('BTN', 'HJ', 10, 6.84, 8.19), ('BTN', 'CO', 10, 9.01, 7.83)]),
    (9, 9, [('SB', 'UTG', 12, 4.0, 1.71), ('SB', 'UTG+1', 12, 4.43, 1.61), ('SB', 'UTG+2', 12, 5.02, 2.26), ('SB', 'LJ', 12, 6.16, 1.79), ('SB', 'HJ', 12, 7.76, 0.81), ('SB', 'CO', 12, 9.66, 0.61), ('SB', 'BTN', 12, 13.26, 1.26)]),
    (9, 10, [('BB', 'UTG', 13, 3.42, 13.51), ('BB', 'UTG+1', 13, 3.7, 14.28), ('BB', 'UTG+2', None, None, None), ('BB', 'LJ', 13, 5.36, 17.06), ('BB', 'HJ', 13, 7.07, 18.19), ('BB', 'CO', 13, 9.04, 20.74), ('BB', 'BTN', 13, 12.87, 26.88), ('BB', 'SB', 13, 12.92, 57.17)]),
]


def source_position(players, position):
    if players == 6 and position == 'HJ':
        return 'MP'
    if players == 9:
        return {'UTG+1': 'UTG1', 'UTG+2': 'MP'}.get(position, position)
    return position


def grid_box(players, page, index):
    if players == 9 and page == 10:
        x = [2, 533, 1062, 1594][index % 4]
        y = 40 if index < 4 else 653
        # BB vs MP was published taller, without an action-size/footer legend.
        return [x, y, 451, 549 if index == 2 else 496]
    return [[0, 516, 1031, 1547][index % 4], 40 if index < 4 else 703, 498, 546]


def metadata_manifest():
    rows = []
    for players, page, entries in PAGES:
        source = next(source for source in SOURCES if source['players'] == players)
        for index, (hero, villain, raise_to, printed_raise, printed_call) in enumerate(entries):
            rows.append({
                'id': f"{source['id']}-{hero.lower().replace('+', 'plus')}-vs-{villain.lower().replace('+', 'plus')}-open",
                'refId': source['refId'], 'players': players, 'stackBb': 100,
                'format': 'cash', 'hero': hero, 'sourcePosition': source_position(players, hero),
                'villain': villain, 'sourceVillain': source_position(players, villain),
                'kind': 'vs-open', 'facingRaiseToBb': 3 if players == 9 or villain == 'SB' else 2.5,
                'raiseToBb': raise_to, 'ante': None, 'rake': None, 'page': page,
                'precision': {'step': 0.5, 'kind': 'publisher-simplified'},
                'source': {'name': 'RangeConverter', 'title': source['title'], 'url': source['url'], 'sha256': source['sha256']},
                'callMeaning': 'Call Open',
                'printedRaisePercent': printed_raise, 'printedCallPercent': printed_call,
                'verification': {
                    'gridBox': grid_box(players, page, index),
                    'cellValidation': 'Both halves agree across independent upper/lower 3x3 samples; all pixels in each patch must match',
                },
            })
    if len(rows) != 51 or len({row['id'] for row in rows}) != 51:
        raise ValueError('The reviewed manifest must contain 51 distinct spots')
    return rows


def verify_sources(directory):
    verified = {}
    for source in SOURCES:
        path = directory / source['file']
        if not path.is_file():
            raise ValueError(f'Missing source PDF: {path}')
        payload = path.read_bytes()
        digest = sha256(payload).hexdigest()
        if digest != source['sha256']:
            raise ValueError(f"SHA-256 mismatch for {path.name}: expected {source['sha256']}, got {digest}. Re-review the source before updating coordinates.")
        verified[source['players']] = payload
    return verified


def classify(rgb):
    distances = {key: sum((a - b) ** 2 for a, b in zip(rgb, color)) for key, color in PALETTE.items()}
    action = min(distances, key=distances.get)
    return action if distances[action] < 2000 else '?'


def half_action(image, box, row, col, fx):
    x, y, width, height = box
    votes = []
    for fy in (0.18, 0.82):
        cx = round(x + (col + fx) * width / 13)
        cy = round(y + (row + fy) * height / 13)
        colors = {classify(image.getpixel((cx + dx, cy + dy))) for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
        if len(colors) != 1 or '?' in colors:
            raise ValueError(f'Unknown or ambiguous patch row={row}, col={col}, half={fx}, height={fy}: {colors}')
        votes.append(next(iter(colors)))
    if votes[0] != votes[1]:
        raise ValueError(f'Upper/lower disagreement row={row}, col={col}, half={fx}: {votes}')
    return votes[0]


def transcribe(image, box):
    frequencies = {}
    for row, first in enumerate(RANKS):
        for col, second in enumerate(RANKS):
            hand = first + second if row == col else first + second + 's' if row < col else second + first + 'o'
            actions = [half_action(image, box, row, col, fx) for fx in (0.24, 0.76)]
            split = {action: actions.count(action) / 2 for action in PALETTE}
            if sum(split.values()) != 1 or not set(split.values()) <= {0, 0.5, 1}:
                raise ValueError(f'Invalid frequency split: {hand}')
            frequencies[hand] = split
    if len(frequencies) != 169:
        raise ValueError('Incomplete chart; refusing to fill missing cells')
    return frequencies


def build_reference(verified):
    nodes = metadata_manifest()
    readers = {players: PdfReader(BytesIO(payload)) for players, payload in verified.items()}
    images = {}
    for node in nodes:
        key = (node['players'], node['page'])
        if key not in images:
            page = readers[key[0]].pages[key[1] - 1]
            if len(page.images) != 1:
                raise ValueError(f'Unexpected image count for {key}')
            image = page.images[0].image.convert('RGB')
            if image.size != (2048, 1313):
                raise ValueError(f'Unexpected original image size for {key}: {image.size}')
            images[key] = image
        try:
            frequencies = transcribe(images[key], node['verification']['gridBox'])
        except ValueError as error:
            raise ValueError(f"{node['id']}: {error}") from error
        node['frequencies'] = frequencies
        node['derivedRangeSummary'] = {
            action: sum(split[action] * (6 if len(hand) == 2 else 4 if hand.endswith('s') else 12)
                        for hand, split in frequencies.items()) / 1326
            for action in PALETTE
        }
    return {
        'schemaVersion': 1, 'kind': 'derived-published-chart', 'preparedAt': '2026-09-30',
        'frequencyUnit': 'fraction',
        'precision': {'step': 0.5, 'label': 'Publisher simplified to 50% steps; not original solver frequencies'},
        'rights': {'availability': 'Publisher offers source PDFs as free downloads', 'redistributionLicense': 'Not established; do not automatically publish this transcription or source files'},
        'unknownConditions': ['numeric rake rate', 'rake cap', 'rake collection rule', 'ante setting', 'solver identity/version', 'convergence or exploitability', '9-max BB vs UTG+2 raise size: source legend absent'],
        'notes': [
            'All cells reproduce only the published 0/50/100 percent actions. No gray or missing cell is converted to Fold.',
            'Facing a single open only: preceding players have folded and there is no intervening caller or raise. This is not a full preflop action tree.',
            'Printed aggregates are transcribed separately and may differ from combination-weighted totals recomputed after cell rounding.',
            'A printed Call aggregate can be nonzero even when no Call survives the publisher rounding in individual cells.',
            'The 9-max BB vs MP (UTG+2) chart on page 10 has a complete hand grid but no action-size or aggregate legend; those fields remain null.',
            'The 6-max BB vs SB Limp diagram is excluded because Check against a limp is not Call Open.',
            'Rake and ante metadata are intentionally not inferred. These charts do not enter exact solver lookup.',
        ],
        'sources': [
            {'id': source['id'], 'name': 'RangeConverter', 'title': source['title'], 'url': source['url'],
             'localFile': source['file'], 'pages': source['pages'], 'sha256': source['sha256']}
            for source in SOURCES
        ],
        'nodes': nodes,
    }


def main():
    parser = argparse.ArgumentParser(description='Transcribe verified 6-max/9-max 100 BB Facing Open charts.')
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY,
                        help='Directory containing both reviewed PDFs; output is written here.')
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    try:
        reference = build_reference(verify_sources(directory))
        payload = (json.dumps(reference, ensure_ascii=False, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8')
        digest = sha256(payload).hexdigest()
        if digest != EXPECTED_OUTPUT_SHA256:
            raise ValueError(f'Output differs from the reviewed transcription: {digest}. Refusing to overwrite existing data.')
        output = directory / 'derived-response-ranges.json'
        output.write_bytes(payload)
        manifest = directory / 'response-chart-manifest.json'
        manifest.write_text(json.dumps(metadata_manifest(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Error: {error}\n')
    print(json.dumps({'file': str(output), 'sha256': sha256(payload).hexdigest(), 'nodes': len(reference['nodes']),
                      'hands': sum(len(node['frequencies']) for node in reference['nodes'])}, indent=2))


if __name__ == '__main__':
    main()
