import catalog from '../data/continuation-catalog.json';
import { CHART_REFERENCES } from '../data/references';
import { HANDS, getPositions, getVillains, type Position } from './poker';

export interface ContinuationAction {
  id: string;
  type: 'raise' | 'call' | 'fold';
  amountBb: number | null;
}
export type ContinuationPrecision =
  | { kind: 'publisher-simplified'; step: 0.5 }
  | { kind: 'graphical-actions'; step: null };
export type ContinuationHand =
  | { status: 'available'; reach: null; frequencies: Record<string, number> }
  | { status: 'actions-only'; reach: null; actions: string[] }
  | { status: 'missing'; reach: null; reason: 'not-shown' | 'ambiguous' };
export interface PublishedContinuationNode {
  id: string;
  refId: string;
  players: 6 | 8 | 9;
  stackBb: 100;
  format: 'cash';
  hero: Position;
  villain: Position;
  sourcePosition: string;
  sourceVillain: string;
  kind: 'vs-3bet' | 'vs-4bet';
  page: number;
  source: { name: string; title: string; url: string; sha256: string };
  openSizeBb: number | null;
  threeBetSizeBb: number | null;
  fourBetSizeBb: number | null;
  ante: null;
  rake: null;
  precision: ContinuationPrecision;
  actions: ContinuationAction[];
  hands: Record<string, ContinuationHand>;
}
export interface PublishedContinuations {
  schemaVersion: 1;
  kind: 'published-continuations';
  preparedAt: string;
  nodes: PublishedContinuationNode[];
}
export interface PublishedContinuationsResponse {
  nodes: PublishedContinuationNode[];
  errors: string[];
}
export const REVIEWED_CONTINUATION_CATALOG = catalog as Omit<PublishedContinuationNode, 'hands'>[];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function sameJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((entry, index) => sameJson(entry, right[index]));
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    return sameKeys(a, Object.keys(b)) && Object.keys(b).every(key => sameJson(a[key], b[key]));
  }
  return left === right;
}

/** Published conditional chart evidence, never an exact-history solver dataset. */
export function validatePublishedContinuations(value: unknown): PublishedContinuations {
  const raw = object(value, 'Continuation library');
  requireValue(raw.schemaVersion === 1 && raw.kind === 'published-continuations', 'Unsupported continuation schema.');
  requireValue(typeof raw.preparedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.preparedAt) &&
    Number.isFinite(Date.parse(raw.preparedAt)) && new Date(raw.preparedAt).toISOString().slice(0, 10) === raw.preparedAt,
  'preparedAt must be a real ISO date.');
  requireValue(Array.isArray(raw.nodes) && raw.nodes.length > 0 && raw.nodes.length <= REVIEWED_CONTINUATION_CATALOG.length,
    'No reviewed continuation charts, or too many nodes.');
  const ids = new Set<string>();
  const spots = new Set<string>();
  const nodes = raw.nodes.map((entry): PublishedContinuationNode => {
    const node = object(entry, 'node');
    const expected = REVIEWED_CONTINUATION_CATALOG.find(item => item.id === node.id);
    requireValue(expected && !ids.has(expected.id), 'Unknown or duplicate continuation chart.');
    ids.add(expected.id);
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      requireValue(sameJson(node[key], expected[key]), `Reviewed chart metadata differs: ${key}.`);
    }
    const ref = CHART_REFERENCES.find(item => item.id === expected.refId);
    requireValue(ref && ref.players === expected.players && expected.source.sha256 === ref.sha256 &&
      expected.source.url === ref.url && expected.source.name === ref.provider && expected.page >= 1 && expected.page <= ref.pages,
    'The continuation source must match its reviewed PDF.');
    requireValue(getPositions(expected.players).includes(expected.hero) &&
      getVillains(expected.players, expected.hero, expected.kind).includes(expected.villain), 'Invalid continuation action order.');
    const spot = `${expected.refId}:${expected.kind}:${expected.hero}:${expected.villain}`;
    requireValue(!spots.has(spot), 'Duplicate continuation spot.');
    spots.add(spot);
    requireValue(node.derivedRangeSummary === undefined && node.rangeSummary === undefined,
      'A node aggregate is unavailable without known reach weights.');
    const actions = expected.actions;
    const actionIds = actions.map(action => action.id);
    requireValue(new Set(actionIds).size === actions.length && actions.length >= 2 && actions.length <= 4, 'Invalid reviewed action set.');
    for (const action of actions) {
      requireValue(['raise', 'call', 'fold'].includes(action.type) &&
        (action.type === 'raise' ? action.amountBb === null || (Number.isFinite(action.amountBb) && action.amountBb > 1 && action.amountBb <= 100)
          : action.amountBb === null), 'Invalid reviewed action amount.');
      requireValue(action.id !== 'allin' || (action.type === 'raise' && action.amountBb === 100), 'All-in must retain its distinct 100 BB action.');
    }
    const rawHands = object(node.hands, 'hands');
    requireValue(sameKeys(rawHands, HANDS), 'Every chart must explicitly represent all 169 canonical hands.');
    let shown = 0;
    const hands = Object.fromEntries(HANDS.map(hand => {
      const row = object(rawHands[hand], hand);
      requireValue(row.reach === null, `${hand}: historical reach must remain unknown.`);
      let result: ContinuationHand;
      if (row.status === 'available') {
        requireValue(expected.precision.kind === 'publisher-simplified' && row.actions === undefined && row.reason === undefined,
          `${hand}: only reviewed simplified charts may contain frequencies.`);
        const frequencies = object(row.frequencies, `${hand}.frequencies`);
        requireValue(sameKeys(frequencies, actionIds) && Object.values(frequencies).every(value => value === 0 || value === 0.5 || value === 1),
          `${hand}: preserve the declared 0/50/100% actions.`);
        requireValue(Object.values(frequencies).reduce<number>((sum, value) => sum + (value as number), 0) === 1,
          `${hand}: conditional actions must sum to one.`);
        result = { status: 'available', reach: null, frequencies: frequencies as Record<string, number> };
        shown++;
      } else if (row.status === 'actions-only') {
        requireValue(expected.precision.kind === 'graphical-actions' && row.frequencies === undefined && row.reason === undefined,
          `${hand}: graphical action evidence cannot claim numerical frequencies.`);
        requireValue(Array.isArray(row.actions) && row.actions.length >= 1 && row.actions.length <= actions.length &&
          new Set(row.actions).size === row.actions.length && row.actions.every(id => typeof id === 'string' && actionIds.includes(id)),
          `${hand}: visible actions must belong to this chart.`);
        result = { status: 'actions-only', reach: null, actions: [...row.actions] as string[] };
        shown++;
      } else {
        requireValue(row.status === 'missing' && (row.reason === 'not-shown' || row.reason === 'ambiguous') &&
          row.frequencies === undefined && row.actions === undefined, `${hand}: unavailable evidence must not become a strategy.`);
        result = { status: 'missing', reach: null, reason: row.reason };
      }
      return [hand, result];
    }));
    requireValue(shown > 0, 'An entirely unreadable chart must stay a PDF reference.');
    return { ...expected, source: { ...expected.source }, precision: { ...expected.precision }, actions: actions.map(action => ({ ...action })), hands };
  });
  return { schemaVersion: 1, kind: 'published-continuations', preparedAt: raw.preparedAt, nodes };
}
