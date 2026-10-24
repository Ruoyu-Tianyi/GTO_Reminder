import type { PublishedChartNode } from './published-charts';
import type { ReferenceAction, ReferenceRange } from './reference-ranges';

export function displayPublishedChart(node: PublishedChartNode): ReferenceRange {
  const actions: ReferenceAction[] = [{ id: 'raise', type: 'raise', label: `${node.kind === 'rfi' ? 'Raise' : '3-Bet'} ${node.raiseToBb ?? '?'} BB`, ...(node.raiseToBb === null ? {} : { amountBb: node.raiseToBb }) }];
  if (node.kind === 'vs-open' || node.callMeaning === 'SB completion / limp') actions.push({ id: 'call', type: 'call', label: node.kind === 'rfi' ? 'Limp' : 'Call' });
  actions.push({ id: 'fold', type: 'fold', label: 'Fold' });
  return {
    ...node, actions, sourcePlayers: node.players, provenance: 'publisher-simplified', precision: 'Publisher simplified to 0 / 50 / 100%; not original solver precision.',
    notes: [node.kind === 'rfi' ? 'All preceding seats fold.' : `${node.villain} opens to ${node.facingRaiseToBb} BB; other preceding seats fold.`, 'Rake and ante are not fully established. Read the original PDF for source conditions.'],
    hands: Object.fromEntries(Object.entries(node.frequencies).map(([hand, row]) => [hand, { status: 'available', frequencies: Object.fromEntries(actions.map(action => [action.id, row[action.id as keyof typeof row]])) }])),
  };
}

export const REFERENCE_KIND_LABELS = {
  rfi: 'Open / RFI', 'vs-open': 'Facing Open', 'vs-3bet': 'Facing 3-Bet', 'vs-4bet': 'Facing 4-Bet', 'vs-5bet': 'Facing 5-Bet All-in', 'vs-limp': 'BB vs SB Limp',
} as const;
export const referenceActionColor = (action: ReferenceAction, index: number) => action.type === 'fold' ? '#e5e9df' : action.type === 'call' || action.type === 'check' ? '#94c5e7' : action.amountBb === 100 ? '#bcafd7' : ['#a8d896', '#edc481', '#69b799'][index % 3];
