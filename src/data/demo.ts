import { HANDS, validateDataset, type Frequencies, type Spot, type SpotKind } from '../lib/poker';

/**
 * These deliberately simple, hand-authored frequencies exercise the interface.
 * They are NOT solver output, expert advice, or a calibrated approximation to GTO.
 * No frequency is copied from a commercial strategy provider.
 */
const DEFAULT_SPOT: Spot = {
  players: 6,
  hero: 'BTN',
  villain: null,
  stackBb: 100,
  kind: 'rfi',
  openSizeBb: 2.5,
  threeBetSizeBb: 10,
  fourBetSizeBb: 22,
  format: 'cash',
  anteBb: 0,
  rake: '5% · 3 BB cap',
};

function demoFrequencies(kind: SpotKind): Record<string, Frequencies> {
  return Object.fromEntries(HANDS.map((hand) => {
    const pair = hand.length === 2;
    const suited = hand.endsWith('s');
    const ace = hand.startsWith('A');
    const premium = ['AA', 'KK', 'QQ', 'AKs', 'AKo'].includes(hand);
    const broadway = ['AK', 'AQ', 'AJ', 'AT', 'KQ', 'KJ', 'KT', 'QJ', 'QT', 'JT'].includes(hand.slice(0, 2));
    let raise = 0;
    let call = 0;
    if (kind === 'rfi') {
      raise = pair || broadway || (ace && suited) ? 1 : suited ? 0.5 : ace ? 0.5 : 0;
    } else if (kind === 'vs-open') {
      raise = premium ? 1 : broadway && suited ? 0.5 : 0;
      call = premium ? 0 : pair || ace || broadway ? 1 - raise : suited ? 0.5 : 0;
    } else if (kind === 'vs-3bet') {
      raise = premium ? 0.75 : ['A5s', 'A4s'].includes(hand) ? 0.25 : 0;
      call = premium ? 0.25 : pair || (suited && broadway) ? 0.5 : 0;
    } else {
      raise = ['AA', 'KK'].includes(hand) ? 1 : premium ? 0.25 : 0;
      call = ['AA', 'KK'].includes(hand) ? 0 : premium ? 0.75 : ['JJ', 'TT', 'AQs'].includes(hand) ? 0.5 : 0;
    }
    return [hand, { raise, call, fold: 1 - raise - call }];
  }));
}

export const DEMO_DATASET = validateDataset({
  schemaVersion: 1,
  id: 'gto-reminder-ui-demo-v1',
  name: 'UI demo — not solver output',
  source: {
    name: 'GTO_Reminder synthetic interface fixtures',
    url: 'https://github.com/Ruoyu-Tianyi/GTO_Reminder',
    license: 'Project-authored synthetic fixtures for UI demonstration only. Not a solved GTO strategy.',
    retrievedAt: '2026-09-26',
    kind: 'demo',
  },
  nodes: [
    { id: 'demo-6m-100-btn-rfi', spot: DEFAULT_SPOT, frequencies: demoFrequencies('rfi') },
    { id: 'demo-6m-100-bb-vs-btn-open', spot: { ...DEFAULT_SPOT, hero: 'BB', villain: 'BTN', kind: 'vs-open' }, frequencies: demoFrequencies('vs-open') },
    { id: 'demo-6m-100-btn-vs-bb-3bet', spot: { ...DEFAULT_SPOT, villain: 'BB', kind: 'vs-3bet' }, frequencies: demoFrequencies('vs-3bet') },
    { id: 'demo-6m-100-bb-vs-btn-4bet', spot: { ...DEFAULT_SPOT, hero: 'BB', villain: 'BTN', kind: 'vs-4bet' }, frequencies: demoFrequencies('vs-4bet') },
  ],
});
