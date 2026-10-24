/** Shared visual semantics for strategy frequencies, independent of their source. */
export const ACTION_COLORS = {
  raise: '#a74f38',
  call: '#226f89',
  check: '#226f89',
  fold: '#263346',
  allIn: '#62539b',
} as const;

export const RAISE_COLORS = [ACTION_COLORS.raise, '#207564', '#876026', ACTION_COLORS.allIn] as const;

export const MISSING_HAND_BACKGROUND = 'repeating-linear-gradient(135deg, #101924 0px, #101924 5px, #263346 5px, #263346 6px)';

/** The optional index counts raises only; calls and folds do not consume a color. */
export function strategyActionColor(action: { type: string; amountBb?: number }, raiseIndex = 0): string {
  if (action.type === 'fold') return ACTION_COLORS.fold;
  if (action.type === 'call' || action.type === 'check') return ACTION_COLORS.call;
  if (action.amountBb === 100) return ACTION_COLORS.allIn;
  return RAISE_COLORS[raiseIndex % RAISE_COLORS.length];
}
