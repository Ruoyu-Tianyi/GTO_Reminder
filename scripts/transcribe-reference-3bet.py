"""Read conditional actions from reviewed 50%-step Facing 3bet diagrams.

Unknown reach remains null. Missing/ambiguous action bands remain missing, never
Fold. This script reads PDF embedded images, not previously exported PNG files.
"""
import argparse
from hashlib import sha256
from functools import lru_cache
from io import BytesIO
import json
from math import ceil, floor
from pathlib import Path

from pypdf import PdfReader

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[1] / 'data' / 'private' / 'research'
EXPECTED_OUTPUT_SHA256 = 'ab2e1658ecfeaa5903ff0608938592d9838e1365b252aa1ee6c16bf15aa9c443'
RANKS = 'AKQJT98765432'
PALETTE = {'raise': (227, 130, 20), 'allin': (164, 22, 26),
           'call': (64, 145, 108), 'fold': (39, 125, 161)}
SOURCES = [
    {'id': 'rangeconverter-6max-100bb-100z', 'refId': 'rangeconverter-6max-100bb',
     'file': 'rangeconverter-6max-100bb.pdf', 'players': 6,
     'title': '6-max 100bb 100z', 'pages': [9, 10, 11, 12, 13],
     'sha256': '60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967',
     'url': 'https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash'},
    {'id': 'rangeconverter-9max-100bb', 'refId': 'rangeconverter-9max-100bb',
     'file': 'rangeconverter-9max-100bb.pdf', 'players': 9,
     'title': '9-max 100bb live cash', 'pages': [11, 12, 13, 14, 15, 16, 17, 18],
     'sha256': '0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27',
     'url': 'https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash'},
]

# Each entry is independently read from its visible legend:
# villain, fixed 4bet-to BB, printed Raise %, Call %, Fold %, All-in % (None if absent).
PAGES = [
    (6, 9, 'UTG', [
        ('HJ', 23.62, 23.34, 8.43, 68.23, None), ('CO', 23.62, 25.29, 6.91, 67.82, None),
        ('BTN', 23.8, 25.81, 10.06, 64.13, None), ('SB', 25.04, 15.58, 23.55, 60.87, None),
        ('BB', 25.01, 12.33, 30.62, 57.05, None)]),
    (6, 10, 'HJ', [
        ('CO', 23.8, 24.31, 5.85, 69.85, None), ('BTN', 23.62, 26.12, 6.19, 67.69, None),
        ('SB', 25.04, 16.92, 19.48, 63.61, None), ('BB', 25.01, 12.5, 29.86, 57.64, None)]),
    (6, 11, 'CO', [
        ('BTN', 23.62, 23.9, 6.31, 69.79, None), ('SB', 25.04, 16.67, 18.52, 64.8, None),
        ('BB', 25.01, 14.0, 26.94, 59.06, None)]),
    (6, 12, 'BTN', [('SB', 25.04, 13.73, 23.52, 62.75, None), ('BB', 25.01, 13.26, 28.47, 58.27, None)]),
    (6, 13, 'SB', [('BB', 27.06, 19.0, 21.98, 59.02, None)]),
    (9, 11, 'UTG', [
        ('UTG+1', 26, 20.33, 15.91, 63.77, 0.0), ('UTG+2', 26, 20.69, 17.44, 61.88, 0.0),
        ('LJ', 26, 20.8, 19.37, 59.83, 0.0), ('HJ', 26, 20.91, 21.53, 57.56, 0.0),
        ('CO', 26, 20.71, 23.83, 55.46, 0.0), ('BTN', 26, 20.42, 26.16, 53.42, 0.0),
        ('SB', 26, 13.14, 32.53, 54.33, 0.0), ('BB', 28, 11.8, 31.73, 56.47, 0.0)]),
    (9, 12, 'UTG+1', [
        ('UTG+2', 26, 18.43, 18.97, 61.5, 1.11), ('LJ', 26, 18.0, 21.14, 59.1, 1.75),
        ('HJ', 26, 17.97, 23.76, 56.65, 1.63), ('CO', 26, 17.98, 26.23, 54.32, 1.48),
        ('BTN', 26, 19.0, 27.99, 52.43, 0.58), ('SB', 26, 10.55, 33.05, 54.54, 1.86),
        ('BB', 28, 10.45, 34.16, 55.4, 0.0)]),
    (9, 13, 'UTG+2', [
        ('LJ', 26, 13.25, 22.45, 58.9, 5.39), ('HJ', 26, 13.82, 24.45, 56.76, 4.97),
        ('CO', 26, 14.85, 26.36, 54.43, 4.36), ('BTN', 26, 15.87, 28.91, 51.91, 3.32),
        ('SB', 26, 7.62, 34.08, 54.21, 4.09), ('BB', 28, 7.68, 36.12, 54.78, 1.42)]),
    (9, 14, 'LJ', [
        ('HJ', 26, 13.14, 23.13, 57.97, 5.77), ('CO', 26, 14.32, 25.08, 55.61, 5.0),
        ('BTN', 26, 15.1, 28.1, 52.62, 4.18), ('SB', 26, 6.91, 35.3, 53.54, 4.26),
        ('BB', 28, 5.21, 35.52, 55.19, 4.08)]),
    (9, 15, 'HJ', [
        ('CO', 26, 14.65, 24.38, 57.54, 3.43), ('BTN', 26, 15.58, 28.08, 53.47, 2.88),
        ('SB', 26, 6.89, 37.53, 52.49, 3.1), ('BB', 28, 5.1, 36.78, 54.17, 3.95)]),
    (9, 16, 'CO', [
        ('BTN', 26, 16.76, 27.17, 54.19, 1.89), ('SB', 26, 8.81, 37.18, 52.83, 1.19),
        ('BB', 28, 7.77, 34.42, 55.73, 2.09)]),
    (9, 17, 'BTN', [('SB', 26, 6.89, 39.08, 51.58, 2.45), ('BB', 28, 7.2, 34.56, 55.71, 2.53)]),
    (9, 18, 'SB', [('BB', 28, 13.46, 20.11, 65.73, 0.7)]),
]


def source_position(players, position):
    if players == 6 and position == 'HJ':
        return 'MP'
    return {'UTG+1': 'UTG1', 'UTG+2': 'MP'}.get(position, position)


def grid_box(players, page, index):
    if players == 9 and page == 11:
        return [[2, 533, 1062, 1594][index % 4], 40 if index < 4 else 653, 451, 496]
    # The MP page has its lower row shifted upward by four pixels.
    y = 40 if index < 4 else (699 if players == 9 and page == 13 else 703)
    return [[2, 517, 1031, 1546][index % 4], y, 498, 546]


def three_bet_size(players, hero, villain):
    # Sizes are explicitly printed in the matching Facing Open diagrams.
    if players == 6:
        return (10.02 if hero == 'SB' else 11.03) if villain == 'BB' else 10.9 if villain == 'SB' else 8.48
    if hero == 'UTG+2' and villain == 'BB':
        return None  # Page 10 BB vs MP has no size/footer legend.
    return 13 if villain == 'BB' else 12 if villain == 'SB' else 10


def manifest():
    nodes = []
    for players, page, hero, entries in PAGES:
        source = next(item for item in SOURCES if item['players'] == players)
        for index, (villain, raise_to, printed_raise, printed_call, printed_fold, printed_allin) in enumerate(entries):
            actions = [{'id': 'raise', 'type': 'raise', 'amountBb': raise_to}]
            if printed_allin is not None:
                actions.append({'id': 'allin', 'type': 'raise', 'amountBb': 100})
            actions.extend([{'id': 'call', 'type': 'call', 'amountBb': None},
                            {'id': 'fold', 'type': 'fold', 'amountBb': None}])
            printed = {'raise': printed_raise, 'call': printed_call, 'fold': printed_fold}
            if printed_allin is not None:
                printed['allin'] = printed_allin
            response_page = ({'HJ': 4, 'CO': 5, 'BTN': 6, 'SB': 7, 'BB': 8}[villain]
                             if players == 6 else {'UTG+1': 4, 'UTG+2': 4, 'LJ': 5, 'HJ': 6, 'CO': 7, 'BTN': 8, 'SB': 9, 'BB': 10}[villain])
            nodes.append({
                'id': f"{source['id']}-{hero.lower().replace('+', 'plus')}-vs-{villain.lower().replace('+', 'plus')}-3bet",
                'refId': source['refId'], 'players': players, 'stackBb': 100, 'format': 'cash',
                'hero': hero, 'villain': villain, 'kind': 'vs-3bet', 'page': page,
                'source': {'name': 'RangeConverter', 'title': source['title'], 'url': source['url'], 'sha256': source['sha256']},
                'sourcePosition': source_position(players, hero), 'sourceVillain': source_position(players, villain),
                'openSizeBb': 3 if players == 9 or hero == 'SB' else 2.5,
                'threeBetSizeBb': three_bet_size(players, hero, villain), 'fourBetSizeBb': None,
                'ante': None, 'rake': None,
                'precision': {'kind': 'publisher-simplified', 'step': 0.5},
                'actions': actions, 'printedActionPercent': printed,
                'verification': {'gridBox': grid_box(players, page, index), 'sourceImageSize': [2048, 1313],
                                 'openSizePage': 3, 'threeBetSizePage': response_page,
                                 'method': 'Two separated 3-pixel samples in each horizontal half; at least three consecutive matching rows; reject conflicting rows'},
            })
    if len(nodes) != 51 or len({node['id'] for node in nodes}) != 51:
        raise ValueError('Expected 51 distinct reviewed Facing 3bet charts')
    return nodes


def verify_sources(directory):
    verified = {}
    for source in SOURCES:
        path = directory / source['file']
        payload = path.read_bytes()
        digest = sha256(payload).hexdigest()
        if digest != source['sha256']:
            raise ValueError(f"SHA-256 mismatch for {path.name}: expected {source['sha256']}, got {digest}")
        verified[source['players']] = payload
    return verified


@lru_cache(maxsize=65536)
def classify(rgb):
    distances = {key: sum((a - b) ** 2 for a, b in zip(rgb, color)) for key, color in PALETTE.items()}
    action = min(distances, key=distances.get)
    return action if distances[action] < 900 else None


def read_cell(image, box, row, col, action_ids):
    x, y, width, height = box
    x0, x1 = x + col * width / 13, x + (col + 1) * width / 13
    y0, y1 = y + row * height / 13, y + (row + 1) * height / 13
    cell_box = [round(x0, 3), round(y0, 3), round(x1 - x0, 3), round(y1 - y0, 3)]
    candidates = []
    saw_action = False
    for py in range(ceil(y0) + 2, floor(y1) - 1):
        halves = []
        for fractions in ((0.18, 0.31), (0.69, 0.82)):
            samples = [classify(image.getpixel((round(x0 + fx * (x1 - x0)) + dx, py)))
                       for fx in fractions for dx in (-1, 0, 1)]
            saw_action = saw_action or any(action is not None for action in samples)
            halves.append(samples[0] if samples[0] is not None and len(set(samples)) == 1 else None)
        if None not in halves:
            if any(action not in action_ids for action in halves):
                raise ValueError(f'Unexpected action color in chart: {halves}')
            candidates.append((py, tuple(halves)))
    signatures = {signature for _, signature in candidates}
    longest = []
    run = []
    for py, signature in candidates:
        if not run or py == run[-1] + 1:
            run.append(py)
        else:
            run = [py]
        if len(run) > len(longest):
            longest = run[:]
    verification = {'cellBox': cell_box, 'sampleRows': []}
    if len(signatures) != 1 or len(longest) < 3:
        return {'status': 'missing', 'reach': None,
                'reason': 'ambiguous' if saw_action else 'not-shown', 'verification': verification}
    signature = next(iter(signatures))
    verification['sampleRows'] = [longest[0], longest[len(longest) // 2], longest[-1]]
    frequencies = {action: signature.count(action) / 2 for action in action_ids}
    if sum(frequencies.values()) != 1:
        raise ValueError('Conditional action frequencies must sum to one')
    return {'status': 'available', 'reach': None, 'frequencies': frequencies, 'verification': verification}


def build_reference(verified):
    readers = {players: PdfReader(BytesIO(payload)) for players, payload in verified.items()}
    images = {}
    nodes = manifest()
    for node in nodes:
        key = (node['players'], node['page'])
        if key not in images:
            page = readers[key[0]].pages[key[1] - 1]
            if len(page.images) != 1:
                raise ValueError(f'Unexpected image count: {key}')
            image = page.images[0].image.convert('RGB')
            if image.size != (2048, 1313):
                raise ValueError(f'Unexpected original image size: {key}')
            images[key] = image
        hands = {}
        for row, first in enumerate(RANKS):
            for col, second in enumerate(RANKS):
                hand = first + second if row == col else first + second + 's' if row < col else second + first + 'o'
                hands[hand] = read_cell(images[key], node['verification']['gridBox'], row, col,
                                        [action['id'] for action in node['actions']])
        if len(hands) != 169 or not any(hand['status'] == 'available' for hand in hands.values()):
            raise ValueError(f"Incomplete or entirely unreadable chart: {node['id']}")
        node['hands'] = hands
    return {
        'schemaVersion': 1, 'kind': 'published-continuations', 'preparedAt': '2026-10-23',
        'frequencyUnit': 'fraction',
        'precision': {'kind': 'publisher-simplified', 'step': 0.5},
        'notes': [
            'Conditional action frequencies reproduce only published 0/50/100 percent horizontal splits; they are not original solver frequencies.',
            'Every hand has unknown reach. A missing hand is not Fold and does not assert zero reach.',
            'Thin or conflicting action bands remain missing. No action is inferred from a separately rounded RFI chart.',
            'Printed action aggregates are separate source annotations. No node-wide percentage is computed without reliable reach.',
            'Open and 3bet sizes come from the matching RFI and Facing Open diagrams in the same verified PDF.',
            '9-max UTG+2 vs BB has unknown prior 3bet size because page 10 BB vs MP has no footer legend.',
            'Rake and ante are not fully established here; these references do not enter exact solver lookup.',
        ],
        'sources': [{'id': source['id'], 'name': 'RangeConverter', 'title': source['title'], 'url': source['url'],
                     'localFile': source['file'], 'pages': source['pages'], 'sha256': source['sha256']}
                    for source in SOURCES],
        'nodes': nodes,
    }


def main():
    parser = argparse.ArgumentParser(description='Transcribe conditional actions from verified Facing 3bet PDF charts.')
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY,
                        help='Directory containing both reviewed PDFs; outputs are written here.')
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    try:
        reference = build_reference(verify_sources(directory))
        payload = (json.dumps(reference, ensure_ascii=False, indent=2) + '\n').replace('\n', '\r\n').encode('utf-8')
        digest = sha256(payload).hexdigest()
        if digest != EXPECTED_OUTPUT_SHA256:
            raise ValueError(f'Output differs from the reviewed transcription: {digest}. Refusing to overwrite existing data.')
        output = directory / 'derived-3bet-ranges.json'
        output.write_bytes(payload)
        (directory / 'threebet-chart-manifest.json').write_text(json.dumps(manifest(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Error: {error}\n')
    available = sum(hand['status'] == 'available' for node in reference['nodes'] for hand in node['hands'].values())
    print(json.dumps({'file': str(output), 'sha256': digest, 'nodes': len(reference['nodes']),
                      'availableHands': available, 'missingHands': 51 * 169 - available}, indent=2))


if __name__ == '__main__':
    main()
