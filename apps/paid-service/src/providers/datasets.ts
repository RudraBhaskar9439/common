/**
 * The paid resources. Deterministic so a demo run is reproducible and two agents
 * buying the same key provably receive the same bytes.
 *
 * Content is synthetic sample data, labeled as such. The point of this service is a
 * genuine x402 payment gate, not the analytical value of the payload.
 */
export interface Dataset {
  id: string;
  description: string;
  /** Capability tags consumers match against before reusing a stored result. */
  capabilities: readonly string[];
  /** Seconds a delivered copy stays fresh. Drives Outcome.freshUntil downstream. */
  freshnessSeconds: number;
  build(): unknown;
}

function seededSeries(seed: number, days: number): number[] {
  const out: number[] = [];
  let value = seed;
  for (let i = 0; i < days; i += 1) {
    value = (value * 1103515245 + 12345) % 2147483648;
    out.push(1000 + (value % 9000));
  }
  return out;
}

export const DATASETS: Record<string, Dataset> = {
  'daily-transfers': {
    id: 'daily-transfers',
    description: 'Daily transfer counts, 30-day window (synthetic sample data).',
    capabilities: ['historical-data', 'daily-granularity'],
    freshnessSeconds: 86_400,
    build() {
      const series = seededSeries(20260910, 30);
      return {
        source: 'common-paid-service',
        disclaimer: 'Synthetic sample data for demonstration. Not real network statistics.',
        window: { days: 30, granularity: 'daily' },
        dailyTransfers: series,
        summary: {
          total: series.reduce((a, b) => a + b, 0),
          mean: Math.round(series.reduce((a, b) => a + b, 0) / series.length),
          peak: Math.max(...series),
        },
      };
    },
  },
  'token-holders': {
    id: 'token-holders',
    description: 'Top token holder distribution snapshot (synthetic sample data).',
    capabilities: ['holder-distribution', 'point-in-time'],
    freshnessSeconds: 3_600,
    build() {
      const balances = seededSeries(77, 10).sort((a, b) => b - a);
      return {
        source: 'common-paid-service',
        disclaimer: 'Synthetic sample data for demonstration. Not real holder data.',
        holders: balances.map((balance, i) => ({ rank: i + 1, balance })),
      };
    },
  },
};

export function findDataset(id: string): Dataset | undefined {
  return DATASETS[id];
}
