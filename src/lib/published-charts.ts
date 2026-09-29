import { CHART_REFERENCES, type ChartReference } from '../data/references';
import { HANDS, comboCount, getPositions, type Frequencies, type Position } from './poker';

export interface PublishedChartNode {
  id: string;
  refId: string;
  players: 6 | 9;
  stackBb: 100;
  format: 'cash';
  hero: Position;
  sourcePosition: string;
  kind: 'rfi';
  raiseToBb: number;
  ante: null;
  rake: null;
  page: 3;
  source: { name: string; title: string; url: string; sha256: string };
  precision: { step: 0.5; kind: 'publisher-simplified' };
  frequencies: Record<string, Frequencies>;
  callMeaning: 'unused' | 'SB completion / limp';
  derivedRangeSummary: Frequencies;
  printedRaisePercent: number;
}

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

/** Validates published, simplified RFI charts. This is NOT a v2 solver dataset. */
export function validatePublishedCharts(value: unknown): PublishedCharts {
  const raw = record(value, 'Published charts');
  requireValue(raw.schemaVersion === 1 && raw.kind === 'derived-published-chart' && raw.frequencyUnit === 'fraction', 'Unsupported published-chart schema or frequency unit.');
  requireValue(typeof raw.preparedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.preparedAt) &&
    Number.isFinite(Date.parse(raw.preparedAt)) && new Date(raw.preparedAt).toISOString().slice(0, 10) === raw.preparedAt,
  'preparedAt must be a real ISO calendar date.');
  const precision = record(raw.precision, 'precision');
  requireValue(precision.step === 0.5 && precision.label === PRECISION_LABEL, 'Published charts must retain the reviewed 50% precision disclosure.');
  requireValue(Array.isArray(raw.sources) && raw.sources.length > 0 && raw.sources.length <= 2, 'sources must identify the reviewed source PDFs.');
  const sources = new Set<string>();
  for (const entry of raw.sources) {
    const source = record(entry, 'source');
    const ref = CHART_REFERENCES.find(ref => REVIEWED_SOURCES[ref.id]?.sourceId === source.id);
    requireValue(ref && source.localFile === ref.filename && source.page === 3 && !sources.has(ref.id), 'Unknown, duplicate or mismatched source metadata.');
    reviewedSource(source, ref);
    sources.add(ref.id);
  }
  requireValue(Array.isArray(raw.nodes) && raw.nodes.length > 0 && raw.nodes.length <= 13, 'nodes must contain 1 to 13 reviewed RFI charts.');
  const ids = new Set<string>();
  const spots = new Set<string>();
  const nodes = raw.nodes.map((entry): PublishedChartNode => {
    const node = record(entry, 'node');
    requireValue(typeof node.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,149}$/.test(node.id) && !ids.has(node.id), 'Each published chart must have a unique safe id.');
    ids.add(node.id);
    const ref = CHART_REFERENCES.find(ref => ref.id === node.refId);
    requireValue(ref && Object.hasOwn(REVIEWED_SOURCES, ref.id) && sources.has(ref.id), 'Unknown or undeclared published-chart reference.');
    requireValue((node.players === 6 || node.players === 9) && node.players === ref.players && node.stackBb === 100 && node.format === 'cash' && node.kind === 'rfi' && node.page === 3 && node.page === ref.rfiPage, 'Chart conditions do not match the reviewed RFI reference.');
    requireValue(typeof node.hero === 'string' && getPositions(node.players).includes(node.hero as Position) && node.hero !== 'BB', 'The hero must be a valid RFI seat in this source.');
    const hero = node.hero as Position;
    const expectedPosition = (node.players === 6 && hero === 'HJ') || (node.players === 9 && hero === 'UTG+2') ? 'MP' : hero;
    requireValue(node.sourcePosition === expectedPosition, 'Source position does not match the reviewed seat mapping.');
    const spot = `${ref.id}:${hero}`;
    requireValue(!spots.has(spot), 'Duplicate published RFI chart for the same source and seat.');
    spots.add(spot);
    const expectedRaise = node.players === 6 && hero !== 'SB' ? 2.5 : 3;
    requireValue(node.raiseToBb === expectedRaise, 'Raise size differs from the published RFI chart.');
    requireValue(node.ante === null && node.rake === null, 'Undisclosed structured ante and rake must remain explicitly null.');
    const nodePrecision = record(node.precision, 'node.precision');
    requireValue(nodePrecision.step === 0.5 && nodePrecision.kind === 'publisher-simplified', 'Node precision must identify the published 50% simplification.');
    const source = reviewedSource(record(node.source, 'node.source'), ref);
    const canLimp = node.players === 6 && hero === 'SB';
    const callMeaning = canLimp ? 'SB completion / limp' : 'unused';
    requireValue(node.callMeaning === callMeaning, 'Call meaning does not match the published action semantics.');
    requireValue(typeof node.printedRaisePercent === 'number' && Number.isFinite(node.printedRaisePercent) && node.printedRaisePercent >= 0 && node.printedRaisePercent <= 100, 'Printed raise percentage must be finite and between 0 and 100.');
    const rows = record(node.frequencies, 'frequencies');
    requireValue(Object.keys(rows).length === 169 && HANDS.every(hand => Object.hasOwn(rows, hand)), 'A published chart must explicitly contain all 169 canonical hand classes.');
    const derivedRangeSummary: Frequencies = { raise: 0, call: 0, fold: 0 };
    const frequencies = Object.fromEntries(HANDS.map(hand => {
      const row = record(rows[hand], hand);
      requireValue(Object.keys(row).length === 3 && ['raise', 'call', 'fold'].every(action => Object.hasOwn(row, action)), `${hand} must contain exactly Raise, Call and Fold.`);
      requireValue([row.raise, row.call, row.fold].every(value => value === 0 || value === 0.5 || value === 1), `${hand} must use the published 0/50/100% steps.`);
      const result: Frequencies = { raise: row.raise as number, call: row.call as number, fold: row.fold as number };
      requireValue(result.raise + result.call + result.fold === 1, `${hand} action frequencies must sum to one.`);
      requireValue(canLimp || result.call === 0, 'Only the reviewed 6-max SB chart contains a Limp action.');
      for (const action of ['raise', 'call', 'fold'] as const) derivedRangeSummary[action] += comboCount(hand) * result[action] / 1326;
      return [hand, result];
    }));
    // Ignore supplied aggregates. Printed source totals remain separate because
    // they need not agree with this combination-weighted, simplified grid.
    return {
      id: node.id, refId: ref.id, players: node.players, stackBb: 100, format: 'cash', hero,
      sourcePosition: expectedPosition, kind: 'rfi', raiseToBb: expectedRaise,
      ante: null, rake: null, page: 3, source,
      precision: { step: 0.5, kind: 'publisher-simplified' }, frequencies,
      callMeaning, printedRaisePercent: node.printedRaisePercent, derivedRangeSummary,
    };
  });
  return { schemaVersion: 1, kind: 'derived-published-chart', preparedAt: raw.preparedAt, frequencyUnit: 'fraction', precision: { step: 0.5, label: PRECISION_LABEL }, nodes };
}
