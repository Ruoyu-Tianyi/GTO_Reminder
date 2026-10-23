"""Read published action colors, never infer solver frequencies from bar widths.

PokerCoaching's reviewed 8-max Cash 100 BB Facing 4-Bet charts are raster
images. Their per-hand numerical frequencies, reach weights, and rounding
policy are not supplied. This script outputs visible action sets only.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

from pypdf import PdfReader


DIRECTORY = Path(__file__).resolve().parents[1] / 'data' / 'private' / 'research'
SOURCE_FILE = 'pokercoaching-ultimate-cash.pdf'
SOURCE_SHA256 = '2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9'
SOURCE_URL = 'https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf'
EXPECTED_OUTPUT_SHA256 = 'f7d22460d1e7522c0def86180b965933cd5c3380bb94952467d2b6c79e45b0b9'
RANKS = 'AKQJT98765432'
ACTION_ORDER = ['allin', 'call', 'fold']
PAGES = [
    (18, [('UTG+1', 'UTG'), ('LJ', 'UTG'), ('HJ', 'UTG'), ('CO', 'UTG'), ('BTN', 'UTG'), ('SB', 'UTG')]),
    (19, [('BB', 'UTG'), ('LJ', 'UTG+1'), ('HJ', 'UTG+1'), ('CO', 'UTG+1'), ('BTN', 'UTG+1'), ('SB', 'UTG+1')]),
    (20, [('BB', 'UTG+1'), ('HJ', 'LJ'), ('CO', 'LJ'), ('BTN', 'LJ'), ('SB', 'LJ'), ('BB', 'LJ')]),
    (21, [('CO', 'HJ'), ('BTN', 'HJ'), ('SB', 'HJ'), ('BB', 'HJ'), ('BTN', 'CO'), ('SB', 'CO')]),
    (22, [('BB', 'CO'), ('SB', 'BTN'), ('BB', 'BTN'), ('BB', 'SB')]),
]


def hand_name(row, column):
    if row == column:
        return RANKS[row] * 2
    return RANKS[min(row, column)] + RANKS[max(row, column)] + ('s' if row < column else 'o')


def color_label(rgb):
    """Conservative color regions, allowing JPEG2000 ringing/gradients."""
    r, g, b = rgb[:3]
    if max(r, g, b) < 42:
        return 'black'
    if r >= 48 and r > 1.55 * g and r > 1.55 * b:
        return 'allin'
    if g >= 85 and g > 1.27 * r and g > 1.18 * b:
        return 'call'
    if b >= 90 and b > 1.3 * r and b > 1.15 * g:
        return 'fold'
    return 'unclear'


def longest_run(indices):
    best = current = 0
    previous = None
    for index in indices:
        current = current + 1 if previous == index - 1 else 1
        previous = index
        best = max(best, current)
    return best


def read_cell(image, row, column):
    # Source images are 1080x693, with a 82px legend and 13 rows of 47px.
    x0, x1 = round(column * 1080 / 13), round((column + 1) * 1080 / 13)
    y0, y1 = 82 + row * 47, 82 + (row + 1) * 47
    # Sample above and below text. Require agreement across both bands;
    # a narrow or inconsistent second color remains ambiguous.
    ys = [y0 + 8, y0 + 10, y1 - 11, y1 - 9]
    columns = {label: [] for label in [*ACTION_ORDER, 'black']}
    uncertain = []
    for x in range(x0 + 1, x1 - 1):
        labels = [color_label(image.getpixel((x, y))) for y in ys]
        top, bottom = Counter(labels[:2]), Counter(labels[2:])
        matches = [label for label in columns if top[label] >= 1 and bottom[label] >= 1 and labels.count(label) >= 3]
        if len(matches) == 1:
            columns[matches[0]].append(x)
        else:
            uncertain.append(x)
    widths = {label: longest_run(values) for label, values in columns.items()}
    evidence = {'box': [x0, y0, x1, y1], 'longestColorRunsPx': widths, 'uncertainColumns': len(uncertain)}
    visible = [action for action in ACTION_ORDER if widths[action] >= 3]
    weak = [action for action in ACTION_ORDER if 0 < widths[action] < 3]
    # Black is deliberately not interpreted as Fold or as proven zero reach.
    if not visible and not weak and len(columns['black']) >= (x1 - x0 - 2) * 0.85:
        return {'status': 'missing', 'reach': None, 'reason': 'not-shown'}, evidence
    if not visible or weak or widths['black'] >= 4 or len(uncertain) > (x1 - x0 - 2) * 0.2:
        return {'status': 'missing', 'reach': None, 'reason': 'ambiguous'}, evidence
    return {'status': 'actions-only', 'reach': None, 'actions': visible}, evidence


def read_source(directory):
    source = directory / SOURCE_FILE
    content = source.read_bytes()
    if sha256(content).hexdigest() != SOURCE_SHA256:
        raise ValueError('Source PDF does not match the visually reviewed version')
    reader = PdfReader(source)
    if len(reader.pages) != 47:
        raise ValueError('Unexpected source page count')
    return reader


def transcribe(directory):
    reader = read_source(directory)
    nodes, audit = [], []
    for page_number, entries in PAGES:
        page = reader.pages[page_number - 1]
        text = page.extract_text()
        if '100BB VS 4-BET' not in text:
            raise ValueError(f'Unexpected page heading at page {page_number}')
        images = [entry for entry in page.images if entry.image.size == (1080, 693)]
        if len(images) != len(entries):
            raise ValueError(f'Unexpected chart count at page {page_number}')
        for index, ((hero, villain), embedded) in enumerate(zip(entries, images)):
            if f'{hero} vs {villain}' not in text:
                raise ValueError(f'Missing expected position title at page {page_number}')
            image = embedded.image.convert('RGB')
            hands, evidence = {}, {}
            for row in range(13):
                for column in range(13):
                    name = hand_name(row, column)
                    hands[name], evidence[name] = read_cell(image, row, column)
            node_id = f"pokercoaching-8max-100bb-{hero.lower().replace('+', 'plus')}-vs-{villain.lower().replace('+', 'plus')}-4bet-actions"
            nodes.append({
                'id': node_id, 'refId': 'pokercoaching-8max-100bb',
                'players': 8, 'stackBb': 100, 'format': 'cash',
                'hero': hero, 'villain': villain, 'kind': 'vs-4bet', 'page': page_number,
                'sourcePosition': hero, 'sourceVillain': villain,
                'source': {'name': 'PokerCoaching', 'title': 'The Ultimate Cash Game Preflop Guide · 2026', 'url': SOURCE_URL, 'sha256': SOURCE_SHA256},
                'precision': {'kind': 'graphical-actions', 'step': None},
                'openSizeBb': None, 'threeBetSizeBb': None, 'fourBetSizeBb': None, 'ante': None, 'rake': None,
                'actions': [
                    {'id': 'allin', 'type': 'raise', 'amountBb': 100},
                    {'id': 'call', 'type': 'call', 'amountBb': None},
                    {'id': 'fold', 'type': 'fold', 'amountBb': None},
                ],
                'hands': hands,
                'verification': {'imageIndex': index, 'imageName': embedded.name, 'imageSize': [1080, 693], 'imageSha256': sha256(embedded.data).hexdigest()},
            })
            audit.append({'id': node_id, 'hands': evidence})
    if len(nodes) != 28 or len({node['id'] for node in nodes}) != 28:
        raise ValueError('Expected 28 distinct reviewed Facing 4-Bet charts')
    artifact = {
        'schemaVersion': 1, 'kind': 'published-continuations', 'preparedAt': '2026-10-23',
        'notes': [
            'Action sets reproduce visible published colors, not exact solver frequencies. No per-hand percentages are generated.',
            'A single visible action does not establish an exact solver frequency of 100%; smaller components may be below image resolution.',
            'All reach weights are unknown. Black cells are not-shown, not automatically Fold or proven unreachable.',
            'Narrow or inconsistent color readings are marked ambiguous. Consult the original PDF for these hands.',
            'The prior open, 3-bet, 4-bet, rake and ante settings are not established here; the displayed Allin action is explicitly 100 BB.',
        ],
        'rights': {'availability': 'Official freely downloadable PDF', 'redistributionLicense': 'Not established; keep the PDF and transcription local'},
        'nodes': nodes,
    }
    return artifact, audit


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=DIRECTORY)
    args = parser.parse_args()
    artifact, audit = transcribe(args.directory)
    output = encode(artifact)
    digest = sha256(output).hexdigest()
    if EXPECTED_OUTPUT_SHA256 and digest != EXPECTED_OUTPUT_SHA256:
        raise ValueError('Transcription differs from the reviewed output; existing artifact was not overwritten')
    destination = args.directory / 'derived-4bet-actions.json'
    destination.write_bytes(output)
    (args.directory / 'fourbet-actions-audit.json').write_bytes(encode(audit))
    statuses = Counter((hand['status'], hand.get('reason', 'shown')) for node in artifact['nodes'] for hand in node['hands'].values())
    print(json.dumps({'file': str(destination), 'sha256': digest, 'nodes': len(artifact['nodes']), 'hands': sum(statuses.values()), 'counts': {':'.join(key): value for key, value in statuses.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
