import { getPositions, getVillains, type Dataset, type Position, type Spot } from './poker';
import { replayPreflop, type PreflopAction } from './preflop';
import { findTreeNode, validateTreeDataset, type TreeDataset, type TreeGame } from './tree-strategy';

/** Only observed actions become history. Future size controls do not prescribe tree actions. */
export function spotToHistory(spot: Spot): { game: TreeGame; history: PreflopAction[] } {
  if (spot.format !== 'cash' || !Number.isInteger(spot.players) || spot.players < 6 || spot.players > 9) {
    throw new Error('Full-history lookup supports 6–9 player Cash tables.');
  }
  const positions = getPositions(spot.players);
  if (!positions.includes(spot.hero) || !['rfi', 'vs-open', 'vs-3bet', 'vs-4bet'].includes(spot.kind)) throw new Error('Invalid position or action line.');
  if (spot.kind === 'rfi' ? spot.villain !== null || spot.hero === 'BB' : !spot.villain || !getVillains(spot.players, spot.hero, spot.kind).includes(spot.villain)) {
    throw new Error('The positions do not form a single-opponent action line.');
  }
  if (!spot.rake.trim() || ![spot.openSizeBb, spot.threeBetSizeBb, spot.fourBetSizeBb].every(size => Number.isFinite(size) && size > 0)) {
    throw new Error('Enter a rake profile and positive bet sizes.');
  }
  const game: TreeGame = { players: spot.players, stackBb: spot.stackBb, anteBb: spot.anteBb, format: 'cash', rake: spot.rake };
  const history: PreflopAction[] = [];
  function act(type: PreflopAction['type'], amountBb?: number) {
    const state = replayPreflop(game, history);
    if (!state.nextActor) throw new Error('This line has no further preflop decision.');
    const action: PreflopAction = { actor: state.nextActor, type, ...(amountBb === undefined ? {} : { amountBb }) };
    replayPreflop(game, [...history, action]); history.push(action);
  }
  function foldTo(position: Position) {
    for (let i = 0; i < spot.players; i++) {
      if (replayPreflop(game, history).nextActor === position) return;
      act('fold');
    }
    throw new Error('The requested position cannot act on this line.');
  }
  if (spot.kind === 'rfi') foldTo(spot.hero);
  else {
    const opener = spot.kind === 'vs-3bet' ? spot.hero : spot.villain!;
    foldTo(opener); act('raise', spot.openSizeBb);
    if (spot.kind === 'vs-open') foldTo(spot.hero);
    else {
      const threeBettor = spot.kind === 'vs-3bet' ? spot.villain! : spot.hero;
      foldTo(threeBettor); act('raise', spot.threeBetSizeBb);
      foldTo(opener);
      if (spot.kind === 'vs-4bet') { act('raise', spot.fourBetSizeBb); foldTo(spot.hero); }
    }
  }
  if (replayPreflop(game, history).nextActor !== spot.hero) throw new Error('This line has no decision for the requested player.');
  return { game, history };
}

/** v2 adds precision. Compare every common source field, independent of key ordering. */
export function sourceSnapshotKey(source: Dataset['source']): string {
  const c = source.computation;
  const tree = c?.tree;
  return JSON.stringify([source.kind, source.name, source.url, source.license, source.retrievedAt,
    c ? [c.engine, c.model, c.iterations, c.status, c.scope, c.modelGapBb,
      tree ? [tree.openSizeBb, tree.threeBetSizeBb, tree.fourBetSizeBb, tree.maxRaises, tree.limp, tree.limpRaiseBb] : null] : null]);
}

export function computedTreeId(dataset: Pick<Dataset, 'id' | 'source'>): string | null {
  return dataset.source.kind === 'computed' && dataset.id.endsWith('-quick') ? `${dataset.id.slice(0, -6)}-part-001` : null;
}

/** Validate before displaying; stale or foreign model snapshots fail closed. */
export function resolveQuickTree(datasets: unknown[], quick: Dataset, spot: Spot): { dataset: TreeDataset; node: TreeDataset['nodes'][number] } | null {
  const treeId = computedTreeId(quick);
  if (!treeId) return null;
  const { game, history } = spotToHistory(spot);
  const candidates = datasets.map(validateTreeDataset);
  for (const candidate of candidates) {
    if (candidate.id !== treeId) throw new Error('The returned tree does not belong to the selected calculation.');
    if (sourceSnapshotKey(candidate.source) !== sourceSnapshotKey(quick.source)) throw new Error('SNAPSHOT_CHANGED');
  }
  const matches = candidates.flatMap(dataset => {
    const node = findTreeNode(dataset, game, history);
    return node ? [{ dataset, node }] : [];
  });
  if (matches.length > 1) throw new Error('Multiple decisions match this history.');
  return matches[0] ?? null;
}
