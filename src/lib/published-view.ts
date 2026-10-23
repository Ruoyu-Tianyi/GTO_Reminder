import type { PublishedChartNode } from './published-charts';
import type { ContinuationHand, PublishedContinuationNode } from './published-continuations';
import type { SpotKind } from './poker';

export type PublishedNode = PublishedChartNode | PublishedContinuationNode;
export type ViewAction = { id: string; label: string; color: string };
export const MISSING_BACKGROUND = 'repeating-linear-gradient(135deg,#f6f7f4 0px,#f6f7f4 5px,#dce2d6 5px,#dce2d6 6px)';
const COLORS = { raise: '#a8d896', call: '#94c5e7', fold: '#e5e9df', allin: '#e9ad87' };

export function isContinuation(node: PublishedNode): node is PublishedContinuationNode {
  return node.kind === 'vs-3bet' || node.kind === 'vs-4bet';
}
export function publishedActions(node: PublishedNode | undefined, kind: SpotKind): ViewAction[] {
  if (node && isContinuation(node)) return node.actions.map(action => ({
    id: action.id,
    label: action.id === 'allin' ? 'All-in 100 BB' : action.type === 'raise'
      ? `${kind === 'vs-3bet' ? '4-Bet' : '5-Bet'}${action.amountBb === null ? ' · size unknown' : ` to ${action.amountBb} BB`}`
      : action.type === 'call' ? 'Call' : 'Fold',
    color: action.id === 'allin' ? COLORS.allin : COLORS[action.type],
  }));
  if (kind === 'vs-3bet' || kind === 'vs-4bet') return [];
  const canCall = kind === 'vs-open' || (node && !isContinuation(node) && node.callMeaning === 'SB completion / limp');
  return [
    { id: 'raise', label: kind === 'vs-open' ? '3-Bet' : 'Raise', color: COLORS.raise },
    ...(canCall ? [{ id: 'call', label: kind === 'vs-open' ? 'Call' : 'Limp', color: COLORS.call }] : []),
    { id: 'fold', label: 'Fold', color: COLORS.fold },
  ];
}
export function publishedHand(node: PublishedNode | undefined, hand: string | null): ContinuationHand | undefined {
  if (!node || !hand) return undefined;
  if (isContinuation(node)) return node.hands[hand];
  const frequencies = node.frequencies[hand];
  return frequencies ? { status: 'available', reach: null, frequencies } : undefined;
}
export function handBackground(row: ContinuationHand | undefined, actions: ViewAction[]): string {
  if (!row || row.status === 'missing') return MISSING_BACKGROUND;
  // Graphical action evidence has no proportional widths. Colored dots identify
  // the visible actions; the neutral cell never implies an equal-frequency mix.
  if (row.status === 'actions-only') return '#f0f4ec';
  let position = 0;
  const segments = actions.map(action => {
    const start = position;
    position += (row.frequencies[action.id] ?? 0) * 100;
    return `${action.color} ${start}% ${position}%`;
  });
  return `linear-gradient(90deg,${segments.join(',')})`;
}
export function handDescription(hand: string, row: ContinuationHand | undefined, actions: ViewAction[]): string {
  if (!row) return `${hand}: missing`;
  if (row.status === 'missing') return `${hand}: ${row.reason === 'not-shown' ? 'not shown in source' : 'ambiguous source'}`;
  if (row.status === 'actions-only') return `${hand}: ${row.actions.map(id => actions.find(action => action.id === id)?.label ?? id).join(' + ')} shown; frequencies not provided`;
  return `${hand}: ${actions.map(action => `${action.label} ${row.frequencies[action.id] * 100}%`).join(', ')}`;
}
