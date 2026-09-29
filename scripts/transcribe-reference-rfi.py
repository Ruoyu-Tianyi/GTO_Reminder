"""Local transcription of the publisher's 50%-step RFI chart cells.

This reads the original images embedded in the freely offered reference PDFs.
It does not reconstruct the original solver precision or fill missing situations.
"""
import argparse
from collections import Counter
from io import BytesIO
from hashlib import sha256
import json
from pathlib import Path

from pypdf import PdfReader

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[1] / 'data' / 'private' / 'research'
EXPECTED_OUTPUT_SHA256 = '9c99741a172bb8534de608385a2380d1da6e5ff267628595a17ed779005ba5f6'
RANKS = 'AKQJT98765432'
PALETTE = {'raise': (227, 130, 20), 'fold': (39, 125, 161), 'limp': (64, 145, 108)}
SOURCES = [
    {
        'id': 'rangeconverter-6max-100bb-100z',
        'file': 'rangeconverter-6max-100bb.pdf',
        'expectedSha256': '60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967',
        'url': 'https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash',
        'players': 6,
        'label': '6-max 100bb 100z',
        'boxes': [('UTG', 'UTG', 0, 40), ('HJ', 'MP', 516, 40), ('CO', 'CO', 1031, 40), ('BTN', 'BTN', 1547, 40), ('SB', 'SB', 0, 703)],
        'gridSize': [498, 546],
        'printedRaisePercent': [17.16, 21.16, 27.18, 40.95, 34.77],
    },
    {
        'id': 'rangeconverter-9max-100bb',
        'file': 'rangeconverter-9max-100bb.pdf',
        'expectedSha256': '0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27',
        'url': 'https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash',
        'players': 9,
        'label': '9-max 100bb live cash',
        'boxes': [('UTG', 'UTG', 2, 40), ('UTG+1', 'UTG+1', 530, 40), ('UTG+2', 'MP', 1059, 40), ('LJ', 'LJ', 1588, 40), ('HJ', 'HJ', 2, 650), ('CO', 'CO', 530, 650), ('BTN', 'BTN', 1059, 650), ('SB', 'SB', 1588, 650)],
        'gridSize': [456, 502],
        'printedRaisePercent': [10.09, 11.44, 13.29, 15.80, 19.76, 25.62, 40.49, 46.36],
    },
]


def classify(rgb):
    distances = {key: sum((a - b) ** 2 for a, b in zip(rgb, color)) for key, color in PALETTE.items()}
    action = min(distances, key=distances.get)
    return action if distances[action] < 2000 else '?'


def cell_half(image, x, y, width, height, row, col, fx):
    votes = []
    for fy in (0.18, 0.82):
        cx = round(x + (col + fx) * width / 13)
        cy = round(y + (row + fy) * height / 13)
        samples = [classify(image.getpixel((cx + dx, cy + dy))) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
        votes.append(Counter(samples).most_common(1)[0][0])
    if votes[0] != votes[1] or '?' in votes:
        raise ValueError(f'Ambiguous cell row={row} col={col} half={fx}: {votes}')
    return votes[0]


def verify_sources(directory):
    """Check every input before any PDF parsing; parse the same verified bytes."""
    verified = {}
    for source in SOURCES:
        path = directory / source['file']
        if not path.is_file():
            raise ValueError(f'Missing source PDF: {path}')
        pdf_bytes = path.read_bytes()
        actual = sha256(pdf_bytes).hexdigest()
        expected = source['expectedSha256']
        if actual != expected:
            raise ValueError(f'SHA-256 mismatch for {path.name}: expected {expected}, got {actual}. Re-review the source before updating chart coordinates.')
        verified[source['file']] = pdf_bytes
    return verified


def build_reference(verified_pdfs):
    result = {
        'schema': 'gto-reminder-published-chart-transcription-v1',
        'preparedAt': '2026-09-29',
        'purpose': 'Personal local reference; this is not a complete preflop solver database.',
        'precision': {'kind': 'publisher-simplified', 'frequencyStep': 0.5, 'originalSolverFrequenciesAvailable': False},
        'rights': {'availability': 'Publisher offers source PDFs as free downloads', 'redistributionLicense': 'Not established; do not automatically publish this transcription or source files'},
        'unknownConditions': ['numeric rake rate', 'rake cap', 'rake collection rule', 'ante setting', 'solver identity/version', 'convergence or exploitability'],
        'notes': [
            'All values reproduce the published 0/50/100 percent chart cells; no original fine-grained solver frequencies are inferred.',
            'The PDF printed range aggregate differs from the aggregate recomputed from the simplified cells. Both are preserved; cells are not adjusted to force a match.',
            'Source MP means HJ on the 6-max chart, and UTG+2 on the 9-max chart, following the published seat order.',
            'The 6-max SB chart labels its passive action Call. In an unopened pot this is a completion/limp, preserved as limp.',
            'RFI spots only. No facing-open, 3bet, 4bet, squeeze, cold-call or 7/8-max strategy is created.',
        ],
        'sources': [],
        'nodes': [],
    }

    for source in SOURCES:
        pdf_bytes = verified_pdfs[source['file']]
        page = PdfReader(BytesIO(pdf_bytes)).pages[2]
        if len(page.images) != 1:
            raise ValueError(f"Unexpected image count in {source['file']} page 3")
        image = page.images[0].image.convert('RGB')
        if image.size != (2048, 1313):
            raise ValueError(f"Unexpected image dimensions in {source['file']}: {image.size}")
        width, height = source['gridSize']
        result['sources'].append({
            'id': source['id'], 'name': 'RangeConverter', 'title': source['label'],
            'url': source['url'], 'localFile': source['file'], 'page': 3,
            'sha256': source['expectedSha256'],
        })
        for index, (hero, source_hero, x, y) in enumerate(source['boxes']):
            hands = {}
            for row, first in enumerate(RANKS):
                for col, second in enumerate(RANKS):
                    hand = first + second if row == col else first + second + 's' if row < col else second + first + 'o'
                    parts = [cell_half(image, x, y, width, height, row, col, fx) for fx in (0.24, 0.76)]
                    hands[hand] = {action: parts.count(action) / 2 for action in PALETTE}
                    if sum(hands[hand].values()) != 1 or not set(hands[hand].values()) <= {0, 0.5, 1}:
                        raise ValueError(f'Invalid frequency split for {hero} {hand}')
            if len(hands) != 169:
                raise ValueError(f'Incomplete hand grid for {hero}')
            if not (source['players'] == 6 and hero == 'SB') and any(v['limp'] != 0 for v in hands.values()):
                raise ValueError(f'Unexpected limp color for {hero}')
            aggregate = {
                action: sum(value[action] * (6 if len(hand) == 2 else 4 if hand.endswith('s') else 12) for hand, value in hands.items()) / 1326
                for action in PALETTE
            }
            result['nodes'].append({
                'id': f"{source['id']}-{hero.lower().replace('+', 'plus')}-rfi",
                'sourceId': source['id'], 'sourcePage': 3, 'sourcePosition': source_hero,
                'players': source['players'], 'stackBb': 100, 'format': 'cash', 'hero': hero,
                'kind': 'rfi', 'openSizeBb': 3 if source['players'] == 9 or hero == 'SB' else 2.5,
                'anteBb': None, 'rake': None,
                'actions': ['raise', 'limp', 'fold'] if source['players'] == 6 and hero == 'SB' else ['raise', 'fold'],
                'frequencies': hands,
                'printedRaisePercent': source['printedRaisePercent'][index],
                'roundedChartAggregate': aggregate,
                'extraction': {'gridBox': [x, y, width, height], 'cellValidation': 'Independent top/bottom 3x3 pixel votes agree in both halves of every cell'},
            })

    # App-facing reference contract. A passive SB completion is stored in `call`
    # for the chart component, with its limp meaning stated explicitly.
    derived = {
        'schemaVersion': 1,
        'kind': 'derived-published-chart',
        'preparedAt': result['preparedAt'],
        'frequencyUnit': 'fraction',
        'precision': {'step': 0.5, 'label': 'Publisher simplified to 50% steps; not original solver frequencies'},
        'rights': result['rights'],
        'unknownConditions': result['unknownConditions'],
        'notes': result['notes'],
        'sources': result['sources'],
        'nodes': [],
    }
    for node in result['nodes']:
        source = next(item for item in result['sources'] if item['id'] == node['sourceId'])
        ref_id = 'rangeconverter-6max-100bb' if node['players'] == 6 else 'rangeconverter-9max-100bb'
        derived['nodes'].append({
            'id': node['id'], 'refId': ref_id,
            'players': node['players'], 'stackBb': 100, 'format': 'cash',
            'hero': node['hero'], 'sourcePosition': node['sourcePosition'],
            'kind': 'rfi', 'raiseToBb': node['openSizeBb'],
            'ante': None, 'rake': None, 'page': 3,
            'precision': {'step': 0.5, 'kind': 'publisher-simplified'},
            'source': {'name': source['name'], 'title': source['title'], 'url': source['url'], 'sha256': source['sha256']},
            'callMeaning': 'SB completion / limp' if node['players'] == 6 and node['hero'] == 'SB' else 'unused',
            'frequencies': {hand: {'raise': freqs['raise'], 'call': freqs['limp'], 'fold': freqs['fold']} for hand, freqs in node['frequencies'].items()},
            'printedRaisePercent': node['printedRaisePercent'],
            'derivedRangeSummary': {'raise': node['roundedChartAggregate']['raise'], 'call': node['roundedChartAggregate']['limp'], 'fold': node['roundedChartAggregate']['fold']},
            'verification': node['extraction'],
        })
    return derived


def main():
    parser = argparse.ArgumentParser(description='Transcribe the verified RangeConverter 6-max/9-max 100 BB RFI reference diagrams.')
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY,
                        help='Directory containing both reviewed PDF files; output is written here (default: repository data/private/research).')
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    try:
        reference = build_reference(verify_sources(directory))
        # The reviewed artifact used Windows CRLF. Fix the encoding and newlines
        # explicitly so Windows, macOS and Linux produce identical bytes.
        text = json.dumps(reference, ensure_ascii=False, indent=2) + '\n'
        payload = text.replace('\n', '\r\n').encode('utf-8')
        digest = sha256(payload).hexdigest()
        if digest != EXPECTED_OUTPUT_SHA256:
            raise ValueError(f'Output differs from the reviewed transcription: {digest}. Existing output has not been changed.')
        output = directory / 'derived-chart-ranges.json'
        output.write_bytes(payload)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Error: {error}\n')
    print(json.dumps({'file': str(output), 'sha256': digest, 'nodes': len(reference['nodes']),
                      'hands': sum(len(node['frequencies']) for node in reference['nodes'])}, indent=2))


if __name__ == '__main__':
    main()
