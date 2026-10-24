import { getPositions, type ComputationTree, type Position } from './poker';
import { replayPreflop, type PreflopAction, type PreflopConfig } from './preflop';

export const LINE_PRESETS = [
  { id: 'unopened', en: 'Unopened · BTN', zh: '无人入池 · BTN' },
  { id: 'bb-open', en: 'BB vs BTN Open', zh: 'BB 面对 BTN Open' },
  { id: 'limp', en: 'BB vs SB Limp', zh: 'BB 面对 SB Limp' },
  { id: 'limp-raise', en: 'SB Limp → BB Raise', zh: 'SB Limp 后面对 BB Raise' },
  { id: 'squeeze', en: 'Open + Call · BTN', zh: 'Open + Call 后轮到 BTN' },
  { id: 'cold-four', en: 'Cold 4-Bet opportunity', zh: '尚未入池时面对 3-Bet' },
  { id: 'three-bet', en: 'Opener facing 3-Bet', zh: 'Open 后面对 3-Bet' },
  { id: 'four-bet', en: 'Facing 4-Bet', zh: '面对 4-Bet' },
  { id: 'five-bet', en: 'Facing 5-Bet All-in', zh: '面对 5-Bet All-in' },
] as const;
export type LinePreset = typeof LINE_PRESETS[number]['id'];
export type PresetSizes = Pick<ComputationTree, 'openSizeBb' | 'threeBetSizeBb' | 'fourBetSizeBb'> & Partial<Pick<ComputationTree, 'limpRaiseBb' | 'maxRaises' | 'limp'>>;

/** A disabled example is not a claim that all enabled examples have strategy data. */
export function getPresetError(config: PreflopConfig, preset: LinePreset, sizes?: PresetSizes): string | null {
  try { buildPreset(config, preset, sizes); return null; }
  catch (error) { return error instanceof Error ? error.message : 'This example is unavailable.'; }
}

/** Example action histories only; these contain no strategy recommendations. */
export function buildPreset(config: PreflopConfig, preset: LinePreset, sizes?: PresetSizes): PreflopAction[] {
  const history: PreflopAction[] = [];
  const positions = getPositions(config.players);
  const openSizeBb = sizes?.openSizeBb ?? 2.5;
  const threeBetSizeBb = sizes?.threeBetSizeBb ?? 8;
  const fourBetSizeBb = sizes?.fourBetSizeBb ?? 22;
  const requiredRaises: Record<LinePreset, number> = { unopened: 0, 'bb-open': 1, limp: 0, 'limp-raise': 1, squeeze: 1, 'cold-four': 2, 'three-bet': 2, 'four-bet': 3, 'five-bet': 4 };
  if (sizes?.maxRaises !== undefined && requiredRaises[preset] > sizes.maxRaises) throw new Error(`This example exceeds the selected model's ${sizes.maxRaises}-raise limit.`);
  if ((preset === 'limp' || preset === 'limp-raise') && sizes?.limp === false) throw new Error('The selected model does not include unopened limps.');
  if (preset === 'limp-raise' && sizes && sizes.limpRaiseBb === undefined) throw new Error('The selected model does not declare a raise size after a limp. Build this history with its documented size.');
  function act(type: PreflopAction['type'], amountBb?: number) {
    const actor = replayPreflop(config, history).nextActor;
    if (!actor) throw new Error('This example needs deeper stacks. Reset to 100 BB.');
    const entry: PreflopAction = { actor, type, ...(amountBb === undefined ? {} : { amountBb }) };
    replayPreflop(config, [...history, entry]); history.push(entry);
  }
  function foldTo(position: Position) {
    for (let i = 0; i < config.players; i++) {
      if (replayPreflop(config, history).nextActor === position) return;
      act('fold');
    }
    throw new Error('Example position cannot act in this line.');
  }
  if (preset === 'unopened') { foldTo('BTN'); return history; }
  if (preset === 'limp' || preset === 'limp-raise') {
    foldTo('SB'); act('call');
    if (preset === 'limp-raise') act('raise', sizes?.limpRaiseBb ?? 4);
    return history;
  }
  if (preset === 'bb-open') { foldTo('BTN'); act('raise', openSizeBb); foldTo('BB'); return history; }
  act('raise', openSizeBb);
  if (preset === 'squeeze') { act('call'); foldTo('BTN'); return history; }
  if (preset === 'cold-four') { act('raise', threeBetSizeBb); foldTo('SB'); return history; }
  foldTo('BTN'); act('raise', threeBetSizeBb); foldTo(positions[0]);
  if (preset === 'three-bet') return history;
  act('raise', fourBetSizeBb);
  if (preset === 'five-bet') {
    const state = replayPreflop(config, history);
    act('raise', state.legal.maxRaiseToBb);
  }
  return history;
}
