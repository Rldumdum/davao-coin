import { BaseError, ContractFunctionRevertedError, formatEther, formatUnits, parseEther, parseUnits } from 'viem';

const DURIAN_DECIMALS = 18;

function trimDecimals(value: string, maxDecimals: number): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const wholeFormatted = BigInt(whole).toLocaleString('en-US');
  const cut = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return cut ? `${wholeFormatted}.${cut}` : wholeFormatted;
}

/** 1000000000000000000000n -> "1,000" */
export const formatDurian = (amount: bigint) => trimDecimals(formatUnits(amount, DURIAN_DECIMALS), 2);
export const formatEth = (wei: bigint) => trimDecimals(formatEther(wei), 4);

/** User text -> base units. Returns null for anything that isn't a positive number. */
export function parseDurian(input: string): bigint | null {
  return parsePositive(input, (s) => parseUnits(s, DURIAN_DECIMALS));
}

export function parseEth(input: string): bigint | null {
  return parsePositive(input, parseEther);
}

function parsePositive(input: string, parse: (s: string) => bigint): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  try {
    const value = parse(s);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

/** Turns viem errors into one readable line, using the contract's custom error name when there is one. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return `Reverted: ${reverted.data.errorName}`;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
