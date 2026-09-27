import { getPositions, getVillains, type Position, type Spot, type SpotKind } from '../lib/poker';
import { POKERCOACHING_PAGES } from './pokercoaching-pages';

export interface ChartReference {
  id: string;
  title: string;
  players: number;
  stackBb: number;
  format: 'cash';
  provider: string;
  url: string;
  filename: string;
  sha256: string;
  pages: number;
  rfiPage: number;
  responsePages: Partial<Record<SpotKind, Partial<Record<Position, number>>>>;
  precision: string;
  conditions: string;
  browsePages?: number[];
  spotPages?: typeof POKERCOACHING_PAGES;
}

// Metadata only. Original PDFs remain in the ignored personal data directory.
export const CHART_REFERENCES: ChartReference[] = [
  {
    id: 'rangeconverter-6max-100bb', title: '6-max · 100 BB · 100z cash',
    players: 6, stackBb: 100, format: 'cash', provider: 'RangeConverter',
    url: 'https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash',
    filename: 'rangeconverter-6max-100bb.pdf',
    sha256: '60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967',
    pages: 13, rfiPage: 3,
    responsePages: {
      'vs-open': { HJ: 4, CO: 5, BTN: 6, SB: 7, BB: 8 },
      'vs-3bet': { UTG: 9, HJ: 10, CO: 11, BTN: 12, SB: 13 },
    },
    precision: '50%', conditions: '100z; rake 5%, cap 2.5 BB. Open 2.5 BB (SB 3 BB). Use the sizes printed on each chart; ante is not established.',
  },
  {
    id: 'pokercoaching-8max-100bb', title: '8-max · 100 BB · Cash guide 2026',
    players: 8, stackBb: 100, format: 'cash', provider: 'PokerCoaching',
    url: 'https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf',
    filename: 'pokercoaching-ultimate-cash.pdf',
    sha256: '2927bdf938a52d95aa53716e5bf61705216da8685d17572775c6f11a0ecd7df9',
    pages: 47, rfiPage: 4, responsePages: {}, spotPages: POKERCOACHING_PAGES,
    browsePages: [1, 2, 3, 4, 5, ...Array.from({ length: 20 }, (_, i) => i + 8)],
    precision: 'Published mixed-frequency charts; rounding unspecified',
    conditions: 'Open 3 BB (SB 4 BB, with Limp). Sizes vary by position. Rake, ante and solver convergence are not disclosed. Page 17 has a conflicting CO heading; CO vs BB Facing 3-Bet is not indexed. Pages 6–7 and 28–47 are 200 BB and excluded from the page selector.',
  },
  {
    id: 'rangeconverter-9max-100bb', title: '9-max · 100 BB · Live cash',
    players: 9, stackBb: 100, format: 'cash', provider: 'RangeConverter',
    url: 'https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash',
    filename: 'rangeconverter-9max-100bb.pdf',
    sha256: '0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27',
    pages: 18, rfiPage: 3,
    responsePages: {
      'vs-open': { 'UTG+1': 4, 'UTG+2': 4, LJ: 5, HJ: 6, CO: 7, BTN: 8, SB: 9, BB: 10 },
      'vs-3bet': { UTG: 11, 'UTG+1': 12, 'UTG+2': 13, LJ: 14, HJ: 15, CO: 16, BTN: 17, SB: 18 },
    },
    precision: '50%', conditions: 'Live cash; Open 3 BB. Use the sizes printed on each chart. Exact rake and ante settings are not established.',
  },
];

export function referencePage(reference: ChartReference, spot: Pick<Spot, 'players' | 'format' | 'stackBb' | 'kind' | 'hero' | 'villain'>): number | null {
  if (spot.players !== reference.players || spot.format !== reference.format || spot.stackBb !== reference.stackBb) return null;
  if (!getPositions(spot.players).includes(spot.hero)) return null;
  if (spot.kind === 'rfi' && spot.villain !== null) return null;
  if (spot.kind !== 'rfi' && (!spot.villain || !getVillains(spot.players, spot.hero, spot.kind).includes(spot.villain))) return null;
  if (reference.spotPages) return reference.spotPages.find(entry => entry.kind === spot.kind && entry.hero === spot.hero && (entry.villain ?? null) === spot.villain)?.page ?? null;
  if (spot.kind === 'rfi') return spot.hero === 'BB' ? null : reference.rfiPage;
  return reference.responsePages[spot.kind]?.[spot.hero] ?? null;
}
