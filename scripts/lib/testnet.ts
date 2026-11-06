/** Shared helpers for the testnet scripts. No key material is handled here. */
import { required, testnetAccount } from '../../packages/near-client/src/index.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Bitcoin-alphabet base58, as used for NEAR code hashes and transaction hashes. */
export function base58(bytes: Uint8Array): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

export const YOCTO_PER_NEAR = 10n ** 24n;
/** Policy expiry used for the hackathon deployment: 2027-03-31T00:00:00Z. */
export const POLICY_EXPIRES_AT_MS = Date.parse('2027-03-31T00:00:00Z');

export function defaultPolicy() {
  return {
    version: '1',
    allowed_recipients: [testnetAccount(required('NEAR_RECIPIENT_ID'))],
    max_transaction: (YOCTO_PER_NEAR / 10n).toString(), // 0.1 NEAR
    daily_limit: (YOCTO_PER_NEAR / 4n).toString(), // 0.25 NEAR
    allowed_actions: ['native_transfer'],
    expires_at_ms: String(POLICY_EXPIRES_AT_MS),
  };
}
