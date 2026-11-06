/**
 * Negative test: sign `create_authorization` with the AGENT's function-call key.
 * NEAR rejects the transaction at the access-key layer (the key only permits
 * submit_intent and execute_intent on the vault), so no transaction is ever created.
 * Run via: node scripts/testnet-role.mjs AGENT scripts/lib/attempt-owner-call.ts
 */
import { actions, teraToGas } from 'near-api-js';
import { accountId, redact, signingAccount } from '../../packages/near-client/src/index.js';

try {
  const agent = await signingAccount('AGENT');
  const forged = {
    id: 'AGENT-SELF-MANDATE', owner_id: accountId('OWNER'), agent_id: accountId('AGENT'), recipient: 'attacker.testnet',
    amount: '500000000000000000000000', max_total: '500000000000000000000000', asset: 'NEAR', purpose_id: 'self-dealing',
    invoice_fingerprint: '0'.repeat(64), expires_at_ms: String(Date.now() + 3_600_000), policy_version: '1', action: 'native_transfer', revoked: false,
  };
  const outcome = await agent.signAndSendTransaction({
    receiverId: accountId('VAULT'),
    actions: [actions.functionCall('create_authorization', { authorization: forged }, teraToGas('30'), 0n)],
    waitUntil: 'FINAL', throwOnFailure: false,
  });
  // Reaching here means the key layer let it through; report the genuine contract outcome.
  const failed = typeof outcome.status === 'object' && outcome.status !== null && 'Failure' in outcome.status;
  console.log(JSON.stringify({ ok: true, result: { succeeded: !failed, layer: 'CONTRACT', failure: failed ? JSON.stringify(outcome.status).slice(0, 400) : null, transaction_hash: outcome.transaction.hash } }));
} catch (error) {
  const message = redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  console.log(JSON.stringify({ ok: true, result: { succeeded: false, failure: message, layer: 'ACCESS_KEY', transaction_hash: null } }));
}
