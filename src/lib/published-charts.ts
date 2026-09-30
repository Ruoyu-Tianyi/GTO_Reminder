import { CHART_REFERENCES, type ChartReference } from '../data/references';
import { HANDS, comboCount, getPositions, getVillains, type Frequencies, type Position } from './poker';

interface PublishedChartBase {
  id: string;
  refId: string;
  players: 6 | 9;
  stackBb: 100;
  format: 'cash';
  hero: Position;
  sourcePosition: string;
  ante: null;
  rake: null;
  page: number;
  source: { name: string; title: string; url: string; sha256: string };
  precision: { step: 0.5; kind: 'publisher-simplified' };
  frequencies: Record<string, Frequencies>;
  derivedRangeSummary: Frequencies;
}

/** Printed charts remain distinct from exact-history solver strategies. */
export type PublishedChartNode = PublishedChartBase & ({
  kind: 'rfi'; villain: null; raiseToBb: number;
  callMeaning: 'unused' | 'SB completion / limp'; printedRaisePercent: number;
} | {
  kind: 'vs-open'; villain: Position; sourceVillain: string; facingRaiseToBb: number;
  raiseToBb: number | null; callMeaning: 'Call Open';
  printedRaisePercent: number | null; printedCallPercent: number | null;
});

export interface PublishedCharts {
  schemaVersion: 1;
  kind: 'derived-published-chart';
  preparedAt: string;
  frequencyUnit: 'fraction';
  precision: { step: 0.5; label: string };
  nodes: PublishedChartNode[];
}

export interface PublishedChartsResponse { nodes: PublishedChartNode[]; error: string | null }

const REVIEWED_SOURCES: Record<string, { title: string; sourceId: string }> = {
  'rangeconverter-6max-100bb': { title: '6-max 100bb 100z', sourceId: 'rangeconverter-6max-100bb-100z' },
  'rangeconverter-9max-100bb': { title: '9-max 100bb live cash', sourceId: 'rangeconverter-9max-100bb' },
};
const PRECISION_LABEL = 'Publisher simplified to 50% steps; not original solver frequencies';

export interface ReviewedResponseChart {
  players: 6 | 9; hero: Position; villain: Position; page: number;
  facingRaiseToBb: number; raiseToBb: number | null; hasCallAction: boolean;
}

// Metadata from the visually reviewed source PDFs, not inferred poker ranges.
// Seven 6-max charts show only Raise/Fold. 9-max BB vs MP has its entire footer
// missing; its visible grid still contains Call, but its raise size is unknown.
export const REVIEWED_RESPONSE_CHARTS: readonly ReviewedResponseChart[] = [
  { players: 6, hero: 'HJ', villain: 'UTG', page: 4, facingRaiseToBb: 2.5, raiseToBb: 8.48, hasCallAction: false },
  { players: 6, hero: 'CO', villain: 'UTG', page: 5, facingRaiseToBb: 2.5, raiseToBb: 8.48, hasCallAction: false },
  { players: 6, hero: 'CO', villain: 'HJ', page: 5, facingRaiseToBb: 2.5, raiseToBb: 8.48, hasCallAction: false },
  { players: 6, hero: 'BTN', villain: 'UTG', page: 6, facingRaiseToBb: 2.5, raiseToBb: 8.48, hasCallAction: true },
  { players: 6, hero: 'BTN', villain: 'HJ', page: 6, facingRaiseToBb: 2.5, raiseToBb: 8.48, hasCallAction: true },
  { players: 6, hero: 'BTN', villain: 'CO', page: 6, facingRaiseToBb: 2.5, raiseToBb: 8.48, hasCallAction: true },
  { players: 6, hero: 'SB', villain: 'UTG', page: 7, facingRaiseToBb: 2.5, raiseToBb: 10.9, hasCallAction: false },
  { players: 6, hero: 'SB', villain: 'HJ', page: 7, facingRaiseToBb: 2.5, raiseToBb: 10.9, hasCallAction: false },
  { players: 6, hero: 'SB', villain: 'CO', page: 7, facingRaiseToBb: 2.5, raiseToBb: 10.9, hasCallAction: false },
  { players: 6, hero: 'SB', villain: 'BTN', page: 7, facingRaiseToBb: 2.5, raiseToBb: 10.9, hasCallAction: false },
  { players: 6, hero: 'BB', villain: 'UTG', page: 8, facingRaiseToBb: 2.5, raiseToBb: 11.03, hasCallAction: true },
  { players: 6, hero: 'BB', villain: 'HJ', page: 8, facingRaiseToBb: 2.5, raiseToBb: 11.03, hasCallAction: true },
  { players: 6, hero: 'BB', villain: 'CO', page: 8, facingRaiseToBb: 2.5, raiseToBb: 11.03, hasCallAction: true },
  { players: 6, hero: 'BB', villain: 'BTN', page: 8, facingRaiseToBb: 2.5, raiseToBb: 11.03, hasCallAction: true },
  { players: 6, hero: 'BB', villain: 'SB', page: 8, facingRaiseToBb: 3, raiseToBb: 10.02, hasCallAction: true },
  { players: 9, hero: 'UTG+1', villain: 'UTG', page: 4, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'UTG+2', villain: 'UTG', page: 4, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'UTG+2', villain: 'UTG+1', page: 4, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'LJ', villain: 'UTG', page: 5, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'LJ', villain: 'UTG+1', page: 5, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'LJ', villain: 'UTG+2', page: 5, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'HJ', villain: 'UTG', page: 6, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'HJ', villain: 'UTG+1', page: 6, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'HJ', villain: 'UTG+2', page: 6, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'HJ', villain: 'LJ', page: 6, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'CO', villain: 'UTG', page: 7, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'CO', villain: 'UTG+1', page: 7, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'CO', villain: 'UTG+2', page: 7, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'CO', villain: 'LJ', page: 7, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'CO', villain: 'HJ', page: 7, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'BTN', villain: 'UTG', page: 8, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'BTN', villain: 'UTG+1', page: 8, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'BTN', villain: 'UTG+2', page: 8, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'BTN', villain: 'LJ', page: 8, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'BTN', villain: 'HJ', page: 8, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'BTN', villain: 'CO', page: 8, facingRaiseToBb: 3, raiseToBb: 10, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'UTG', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'UTG+1', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'UTG+2', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'LJ', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'HJ', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'CO', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'SB', villain: 'BTN', page: 9, facingRaiseToBb: 3, raiseToBb: 12, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'UTG', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'UTG+1', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'UTG+2', page: 10, facingRaiseToBb: 3, raiseToBb: null, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'LJ', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'HJ', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'CO', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'BTN', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
  { players: 9, hero: 'BB', villain: 'SB', page: 10, facingRaiseToBb: 3, raiseToBb: 13, hasCallAction: true },
];

function sourcePosition(players: number, hero: Position, kind: 'rfi' | 'vs-open' = 'rfi'): string {
  if (players === 9 && hero === 'UTG+1' && kind === 'vs-open') return 'UTG1';
  return (players === 6 && hero === 'HJ') || (players === 9 && hero === 'UTG+2') ? 'MP' : hero;
}
function validPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function reviewedSource(raw: Record<string, unknown>, ref: ChartReference): PublishedChartNode['source'] {
  const known = REVIEWED_SOURCES[ref.id];
  requireValue(known && raw.name === ref.provider && raw.title === known.title && raw.url === ref.url &&
    typeof raw.sha256 === 'string' && raw.sha256.toLowerCase() === ref.sha256,
  'Source identity, URL or PDF hash does not match the reviewed reference.');
  return { name: ref.provider, title: known.title, url: ref.url, sha256: ref.sha256 };
}

/** Validates published, simplified charts. This is NOT a v2 solver dataset. */
export function validatePublishedCharts(value: unknown): PublishedCharts {
  const raw = record(value, 'Published charts');
  requireValue(raw.schemaVersion === 1 && raw.kind === 'derived-published-chart' && raw.frequencyUnit === 'fraction', 'Unsupported published-chart schema or frequency unit.');
  requireValue(typeof raw.preparedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.preparedAt) &&
    Number.isFinite(Date.parse(raw.preparedAt)) && new Date(raw.preparedAt).toISOString().slice(0, 10) === raw.preparedAt,
  'preparedAt must be a real ISO calendar date.');
  const precision = record(raw.precision, 'precision');
  requireValue(precision.step === 0.5 && precision.label === PRECISION_LABEL, 'Published charts must retain the reviewed 50% precision disclosure.');
  requireValue(Array.isArray(raw.nodes) && raw.nodes.length > 0 && raw.nodes.length <= 64, 'nodes must contain 1 to 64 reviewed charts.');
  const firstKind = record(raw.nodes[0], 'node').kind;
  requireValue(firstKind === 'rfi' || firstKind === 'vs-open', 'Only reviewed RFI and Facing Open charts are supported.');
  requireValue(Array.isArray(raw.sources) && raw.sources.length > 0 && raw.sources.length <= 2, 'sources must identify the reviewed source PDFs.');
  const sources = new Set<string>();
  for (const entry of raw.sources) {
    const source = record(entry, 'source');
    const ref = CHART_REFERENCES.find(ref => REVIEWED_SOURCES[ref.id]?.sourceId === source.id);
    requireValue(ref && source.localFile === ref.filename && !sources.has(ref.id), 'Unknown, duplicate or mismatched source metadata.');
    if (firstKind === 'rfi') requireValue(source.page === 3 && source.pages === undefined, 'RFI source metadata must identify page 3.');
    else {
      const pages = ref.players === 6 ? [4, 5, 6, 7, 8] : [4, 5, 6, 7, 8, 9, 10];
      requireValue(source.page === undefined && Array.isArray(source.pages) && source.pages.length === pages.length && source.pages.every((page, index) => page === pages[index]), 'Facing Open source pages do not match the reviewed reference.');
    }
    reviewedSource(source, ref);
    sources.add(ref.id);
  }
  requireValue(raw.nodes.length <= (firstKind === 'rfi' ? 13 : 51), 'Chart count exceeds the reviewed catalog.');
  const ids = new Set<string>();
  const spots = new Set<string>();
  const nodes = raw.nodes.map((entry): PublishedChartNode => {
    const node = record(entry, 'node');
    requireValue(typeof node.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,149}$/.test(node.id) && !ids.has(node.id), 'Each published chart must have a unique safe id.');
    ids.add(node.id);
    const ref = CHART_REFERENCES.find(ref => ref.id === node.refId);
    requireValue(ref && Object.hasOwn(REVIEWED_SOURCES, ref.id) && sources.has(ref.id), 'Unknown or undeclared published-chart reference.');
    requireValue((node.players === 6 || node.players === 9) && node.players === ref.players && node.stackBb === 100 && node.format === 'cash' && node.kind === firstKind, 'Chart conditions do not match the reviewed reference.');
    requireValue(typeof node.hero === 'string' && getPositions(node.players).includes(node.hero as Position), 'The hero must be a valid seat in this source.');
    const hero = node.hero as Position;
    const expectedPosition = sourcePosition(node.players, hero, firstKind);
    requireValue(node.sourcePosition === expectedPosition, 'Source position does not match the reviewed seat mapping.');
    let responseChart: ReviewedResponseChart | undefined;
    if (firstKind === 'rfi') {
      requireValue(hero !== 'BB' && node.page === 3 && node.page === ref.rfiPage, 'The hero and page must identify a reviewed RFI chart.');
      requireValue((node.villain === undefined || node.villain === null) && node.sourceVillain === undefined && node.facingRaiseToBb === undefined, 'RFI charts cannot include an opener or a faced raise.');
    } else {
      requireValue(typeof node.villain === 'string' && getVillains(node.players, hero, 'vs-open').includes(node.villain as Position), 'Facing Open must identify a preceding opener in action order.');
      responseChart = REVIEWED_RESPONSE_CHARTS.find(chart => chart.players === node.players && chart.hero === hero && chart.villain === node.villain);
      requireValue(responseChart && node.page === responseChart.page && node.page === ref.responsePages['vs-open']?.[hero] && node.sourceVillain === sourcePosition(node.players, responseChart.villain, 'vs-open') && node.facingRaiseToBb === responseChart.facingRaiseToBb, 'Facing Open page, opener or open size differs from the reviewed chart.');
    }
    const spot = `${ref.id}:${firstKind}:${hero}:${responseChart?.villain ?? ''}`;
    requireValue(!spots.has(spot), 'Duplicate published chart for the same source and seat or matchup.');
    spots.add(spot);
    const expectedRaise = responseChart ? responseChart.raiseToBb : node.players === 6 && hero !== 'SB' ? 2.5 : 3;
    requireValue(node.raiseToBb === expectedRaise, 'Raise size differs from the published chart.');
    requireValue(node.ante === null && node.rake === null, 'Undisclosed structured ante and rake must remain explicitly null.');
    const nodePrecision = record(node.precision, 'node.precision');
    requireValue(nodePrecision.step === 0.5 && nodePrecision.kind === 'publisher-simplified', 'Node precision must identify the published 50% simplification.');
    const source = reviewedSource(record(node.source, 'node.source'), ref);
    const canLimp = firstKind === 'rfi' && node.players === 6 && hero === 'SB';
    const callMeaning = responseChart ? 'Call Open' : canLimp ? 'SB completion / limp' : 'unused';
    requireValue(node.callMeaning === callMeaning, 'Call meaning does not match the published action semantics.');
    const legendMissing = responseChart?.raiseToBb === null;
    requireValue(legendMissing ? node.printedRaisePercent === null && node.printedCallPercent === null : validPercent(node.printedRaisePercent) && (!responseChart || (responseChart.hasCallAction ? validPercent(node.printedCallPercent) : node.printedCallPercent === null)), 'Printed percentages must be valid, and a missing legend must remain explicitly null.');
    const rows = record(node.frequencies, 'frequencies');
    requireValue(Object.keys(rows).length === 169 && HANDS.every(hand => Object.hasOwn(rows, hand)), 'A published chart must explicitly contain all 169 canonical hand classes.');
    const derivedRangeSummary: Frequencies = { raise: 0, call: 0, fold: 0 };
    const frequencies = Object.fromEntries(HANDS.map(hand => {
      const row = record(rows[hand], hand);
      requireValue(Object.keys(row).length === 3 && ['raise', 'call', 'fold'].every(action => Object.hasOwn(row, action)), `${hand} must contain exactly Raise, Call and Fold.`);
      requireValue([row.raise, row.call, row.fold].every(value => value === 0 || value === 0.5 || value === 1), `${hand} must use the published 0/50/100% steps.`);
      const result: Frequencies = { raise: row.raise as number, call: row.call as number, fold: row.fold as number };
      requireValue(result.raise + result.call + result.fold === 1, `${hand} action frequencies must sum to one.`);
      requireValue(responseChart || canLimp || result.call === 0, 'Only the reviewed 6-max SB chart contains a Limp action.');
      requireValue(!responseChart || responseChart.hasCallAction || result.call === 0, 'This reviewed Facing Open chart contains only Raise and Fold.');
      for (const action of ['raise', 'call', 'fold'] as const) derivedRangeSummary[action] += comboCount(hand) * result[action] / 1326;
      return [hand, result];
    }));
    // Ignore supplied aggregates. Printed source totals remain separate because
    // they need not agree with this combination-weighted, simplified grid.
    const common: PublishedChartBase = {
      id: node.id, refId: ref.id, players: node.players, stackBb: 100, format: 'cash', hero,
      sourcePosition: expectedPosition, ante: null, rake: null, page: node.page as number, source,
      precision: { step: 0.5, kind: 'publisher-simplified' }, frequencies,
      derivedRangeSummary,
    };
    if (responseChart) return {
      ...common, kind: 'vs-open', villain: responseChart.villain,
      sourceVillain: sourcePosition(node.players, responseChart.villain, 'vs-open'), facingRaiseToBb: responseChart.facingRaiseToBb,
      raiseToBb: responseChart.raiseToBb, callMeaning: 'Call Open',
      printedRaisePercent: node.printedRaisePercent as number | null, printedCallPercent: node.printedCallPercent as number | null,
    };
    return { ...common, kind: 'rfi', villain: null, raiseToBb: expectedRaise as number,
      callMeaning: canLimp ? 'SB completion / limp' : 'unused', printedRaisePercent: node.printedRaisePercent as number };
  });
  return { schemaVersion: 1, kind: 'derived-published-chart', preparedAt: raw.preparedAt, frequencyUnit: 'fraction', precision: { step: 0.5, label: PRECISION_LABEL }, nodes };
}
