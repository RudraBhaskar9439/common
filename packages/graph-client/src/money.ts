import type { Money } from '@common/interfaces';

/**
 * Decimals are not on chain. `PurchaseReserved.asset` carries a Hedera token id — `0.0.0`
 * for HBAR — and nothing in any event says how to scale it.
 *
 * `packages/hedera-adapter` already fixes the convention as `asset === '0.0.0' ? 8 : 0`.
 * This mirrors it exactly rather than inventing a second rule. Promoting it to one shared
 * constant is proposed in docs/workstreams/aditya.md §5 P5.
 */
export const HBAR_TOKEN_ID = '0.0.0';
export const DEFAULT_ASSET_DECIMALS: Readonly<Record<string, number>> = { [HBAR_TOKEN_ID]: 8 };

export type AssetRegistry = Readonly<Record<string, number>>;

/**
 * Amounts stay integer strings end to end. Converting to a JS number would lose precision
 * above 2^53, and these are token units in the smallest denomination.
 */
export function toMoney(amount: string, asset: string, registry: AssetRegistry): Money {
  const decimals = registry[asset];
  return {
    amount,
    tokenId: asset,
    // An unknown asset reports 0 decimals, which is wrong for display but never wrong
    // about the integer amount actually paid. Supply the real value before using HTS.
    decimals: decimals === undefined ? 0 : decimals,
  };
}

export function isKnownAsset(asset: string, registry: AssetRegistry): boolean {
  return registry[asset] !== undefined;
}
