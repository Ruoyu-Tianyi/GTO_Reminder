import type { PublishedChartNode } from './published-charts';
import type { ReferenceHand, ReferenceRange } from './reference-ranges';

/** Another presentation of the same image transcription, never a new solve. */
export function supportsActionView(node: ReferenceRange | undefined): boolean {
  return node?.provenance === 'image-transcription' && node.players === 8 && node.sourcePlayers === 8;
}

export function transcribedActions(row: ReferenceHand | undefined, actionIds: string[]): string[] | null {
  return row?.status === 'available' ? actionIds.filter(id => row.frequencies[id] > 0) : null;
}

/** Match the same PDF and seats; missing legends stay unknown. */
export function precedingRaiseSizes(node: ReferenceRange | undefined, published: PublishedChartNode[]): {
  openSizeBb: number | null; threeBetSizeBb: number | null;
} | null {
  if (!node || node.kind !== 'vs-3bet' || node.provenance !== 'publisher-simplified' || node.players !== node.sourcePlayers) return null;
  const sameSource = (item: PublishedChartNode) => item.refId === node.refId && item.players === node.players &&
    item.stackBb === node.stackBb && item.source.sha256 === node.source.sha256;
  const open = published.find(item => sameSource(item) && item.kind === 'rfi' && item.hero === node.hero);
  const threeBet = published.find(item => sameSource(item) && item.kind === 'vs-open' && item.hero === node.villain && item.villain === node.hero);
  return { openSizeBb: open?.raiseToBb ?? null, threeBetSizeBb: threeBet?.raiseToBb ?? null };
}
