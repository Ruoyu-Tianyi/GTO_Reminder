import { HANDS, getPositions, getVillains, type Position } from './poker';
import { CHART_REFERENCES } from '../data/references';
import { POKERCOACHING_PAGES } from '../data/pokercoaching-pages';
import { EXTENDED_REFERENCE_PAGES } from '../data/extended-reference-pages';

export type ReferenceKind = 'rfi' | 'vs-open' | 'vs-3bet' | 'vs-4bet' | 'vs-5bet' | 'vs-limp';
export interface ReferenceAction { id: string; label: string; type: 'raise' | 'call' | 'fold' | 'check'; amountBb?: number }
export type ReferenceHand = { status: 'available'; frequencies: Record<string, number> } | { status: 'not-charted' | 'unreadable' };
export interface ReferenceRange {
  id: string; refId: string; players: number; stackBb: number; kind: ReferenceKind;
  hero: Position; villain: Position | null; page: number;
  actions: ReferenceAction[]; hands: Record<string, ReferenceHand>; notes: string[]; precision: string;
  provenance: 'image-transcription' | 'seat-projection' | 'publisher-simplified'; sourcePlayers: number;
  source: { name: string; title: string; url: string; sha256: string };
}
export interface ReferenceRangesResponse { nodes: ReferenceRange[]; error: string | null }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const string = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Source validation does not turn image measurements into original solver output. */
export function validateReferenceRanges(input: unknown): ReferenceRange[] {
  const raw = object(input);
  requireValue(raw.schemaVersion === 1 && raw.kind === 'reference-ranges', 'Unsupported reference schema.');
  const src = object(raw.source);
  const ref = CHART_REFERENCES.find(item => item.provider === src.name && item.url === src.url && item.sha256 === src.sha256);
  requireValue(ref && string(src.title), 'Unreviewed source identity.');
  const source = { name: ref.provider, title: src.title, url: ref.url, sha256: ref.sha256 };
  requireValue(Array.isArray(raw.nodes) && raw.nodes.length > 0 && raw.nodes.length <= 150, 'Invalid chart count.');
  const ids = new Set<string>(), spots = new Set<string>();
  return raw.nodes.map(value => {
    const node = object(value);
    requireValue(string(node.id) && /^[a-z0-9_-]+$/.test(node.id) && !ids.has(node.id), 'Duplicate or invalid chart ID.');
    ids.add(node.id);
    requireValue(node.players === ref.players && node.stackBb === 100 && node.refId === ref.id, 'Conditions differ from the reviewed source.');
    const positions = getPositions(ref.players);
    requireValue(positions.includes(node.hero as Position) && (node.villain === null || positions.includes(node.villain as Position)), 'Invalid source seats.');
    const hero = node.hero as Position, villain = node.villain as Position | null;
    requireValue(['rfi', 'vs-open', 'vs-3bet', 'vs-4bet', 'vs-5bet', 'vs-limp'].includes(node.kind as string), 'Invalid scenario.');
    const kind = node.kind as ReferenceKind;
    const known = ref.players === 8 ? POKERCOACHING_PAGES.some(entry => entry.kind === kind && entry.hero === hero && (entry.villain ?? null) === villain && entry.page === node.page)
      || EXTENDED_REFERENCE_PAGES.some(entry => entry.hero === hero && entry.villain === villain && entry.page === node.page &&
        ((kind === 'vs-limp' && entry.scenario === 'bb-vs-sb-limp') || (kind === 'vs-5bet' && entry.scenario === 'vs-5bet-shove')))
      : kind === 'vs-3bet' && villain !== null && getVillains(ref.players, hero, kind).includes(villain) && ref.responsePages['vs-3bet']?.[hero] === node.page;
    requireValue(known, 'Scenario/page is not in the reviewed source catalog.');
    const key = `${kind}:${hero}:${villain}`;
    requireValue(!spots.has(key), 'Duplicate source scenario.'); spots.add(key);
    requireValue(Array.isArray(node.actions) && node.actions.length >= 2 && node.actions.length <= 5, 'Invalid action count.');
    const actionIds = new Set<string>();
    const actions = node.actions.map(value => {
      const action = object(value);
      requireValue(string(action.id) && /^[a-z][a-z0-9_-]*$/.test(action.id) && !['constructor','prototype','__proto__'].includes(action.id) && !actionIds.has(action.id), 'Invalid action ID.');
      actionIds.add(action.id);
      requireValue(string(action.label) && ['raise','call','fold','check'].includes(action.type as string), 'Invalid action.');
      requireValue(action.amountBb === undefined || (action.type === 'raise' && typeof action.amountBb === 'number' && Number.isFinite(action.amountBb) && action.amountBb > 0 && action.amountBb <= 100), 'Invalid raise size.');
      return { id: action.id, label: action.label, type: action.type as ReferenceAction['type'], ...(action.amountBb === undefined ? {} : { amountBb: action.amountBb as number }) };
    });
    const rows = object(node.hands);
    requireValue(Object.keys(rows).length === 169 && HANDS.every(hand => Object.hasOwn(rows, hand)), 'Every hand needs an explicit status.');
    const hands = Object.fromEntries(HANDS.map(hand => {
      const row = object(rows[hand]);
      if (row.status === 'not-charted' || row.status === 'unreadable') {
        requireValue(row.frequencies === undefined, 'Missing hands cannot contain frequencies.');
        return [hand, { status: row.status } as ReferenceHand];
      }
      requireValue(row.status === 'available', 'Invalid hand status.');
      const frequencies = object(row.frequencies);
      requireValue(Object.keys(frequencies).length === actionIds.size && [...actionIds].every(id => Object.hasOwn(frequencies, id)), 'Actions must match the legend.');
      const values = Object.values(frequencies);
      requireValue(values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1), 'Invalid frequency.');
      requireValue(Math.abs((values as number[]).reduce((a, b) => a + b, 0) - 1) <= 0.00001, 'Frequencies must sum to one.');
      return [hand, { status: 'available', frequencies: frequencies as Record<string, number> } as ReferenceHand];
    }));
    requireValue(string(node.precision) && Array.isArray(node.notes) && node.notes.every(string), 'Precision and source notes are required.');
    return { id: node.id, refId: ref.id, players: ref.players, stackBb: 100, kind, hero, villain, page: node.page as number,
      actions, hands, notes: node.notes as string[], precision: node.precision, provenance: ref.players === 8 ? 'image-transcription' : 'publisher-simplified', sourcePlayers: ref.players, source };
  });
}

/** Explicit approximation requested by the user; never entered into exact strategy datasets. */
export function projectSevenMax(nodes: readonly ReferenceRange[]): ReferenceRange[] {
  const mapSeat = (position: Position): Position => position === 'UTG+1' ? 'UTG' : position;
  return nodes.filter(node => node.players === 8 && node.provenance === 'image-transcription' && node.hero !== 'UTG' && node.villain !== 'UTG').map(node => ({
    ...node, id: `estimate-7-${node.id}`, players: 7, hero: mapSeat(node.hero), villain: node.villain ? mapSeat(node.villain) : null,
    provenance: 'seat-projection' as const,
    notes: [
      'Estimated 7-max reference: remove the earliest 8-max UTG seat; map UTG+1 to UTG, preserving the remaining order and source bet sizes.',
      'Assumes the removed seat has no effect on the remaining card distribution or strategies. No card-bunching correction, re-solving, or 7-max equilibrium verification.',
      ...node.notes,
    ],
  }));
}

export function referenceVillains(players: number, hero: Position, kind: ReferenceKind): Position[] {
  if (kind === 'vs-limp') return hero === 'BB' ? ['SB'] : [];
  return getVillains(players, hero, kind === 'vs-5bet' ? 'vs-3bet' : kind);
}
