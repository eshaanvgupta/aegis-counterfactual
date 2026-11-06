/**
 * Deploy and initialize the vault in ONE transaction signed by the vault account.
 *
 *   pnpm testnet:deploy [policy.json]
 *
 * Refuses to overwrite an account that already has code, verifies the artifact against
 * artifacts/contract-build.json, and records the on-chain code hash, which NEAR defines
 * as base58(sha256(wasm)), in artifacts/testnet-deployment.json.
 */
import { actions, teraToGas } from 'near-api-js';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  REPO_ROOT, accountId, main, print, provider, readJson, recordEvidence, signingAccount, toEvidence, view,
  type OutcomeLike,
} from '../packages/near-client/src/index.js';
import { base58, defaultPolicy } from './lib/testnet.js';

await main(async () => {
  const wasmPath = resolve(REPO_ROOT, 'artifacts/aegis_vault.wasm');
  const code = await readFile(wasmPath);
  const build = await readJson<{ sha256: string; bytes: number }>(resolve(REPO_ROOT, 'artifacts/contract-build.json'));
  const sha = createHash('sha256').update(code).digest('hex');
  if (sha !== build.sha256) throw new Error('artifacts/aegis_vault.wasm does not match contract-build.json. Run pnpm build:contract.');

  const vaultId = accountId('VAULT');
  const state = await provider().viewAccount({ accountId: vaultId });
  if (state.code_hash !== '11111111111111111111111111111111') {
    throw new Error(`${vaultId} already has code (${state.code_hash}). Refusing to overwrite a deployed vault.`);
  }
  const policy = process.argv[2] ? await readJson<Record<string, unknown>>(process.argv[2]) : defaultPolicy();
  const init = { owner_id: accountId('OWNER'), agent_id: accountId('AGENT'), attestor_id: accountId('ATTESTOR'), policy };

  const signer = await signingAccount('VAULT');
  const outcome = await signer.signAndSendTransaction({
    receiverId: vaultId,
    waitUntil: 'FINAL',
    throwOnFailure: false,
    actions: [actions.deployContract(code), actions.functionCall('init', init, teraToGas('100'), 0n)],
  });
  const evidence = await recordEvidence(toEvidence('Deploy contract and initialize principals atomically', 'VAULT', 'deploy_and_init', outcome as unknown as OutcomeLike));
  if (!evidence.succeeded) {
    print(evidence);
    throw new Error('Deployment failed (actions in one receipt are atomic, so nothing was deployed). See the genuine outcome above.');
  }

  const deployed = await provider().viewAccount({ accountId: vaultId });
  const expectedCodeHash = base58(createHash('sha256').update(code).digest());
  if (deployed.code_hash !== expectedCodeHash) throw new Error(`On-chain code hash ${deployed.code_hash} != local ${expectedCodeHash}`);
  const status = await view<Record<string, unknown>>('get_vault_status');
  const record = {
    network_id: 'testnet',
    vault_id: vaultId,
    deployed_at: evidence.timestamp,
    transaction_hash: evidence.transaction_hash,
    explorer_url: evidence.explorer_url,
    code_hash: deployed.code_hash,
    wasm_sha256: sha,
    wasm_bytes: code.length,
    principals: { owner: init.owner_id, agent: init.agent_id, attestor: init.attestor_id },
    policy,
    vault_status_after_init: status,
    verification: `Compare code_hash with base58(sha256(artifacts/aegis_vault.wasm)); query ${vaultId} on any testnet RPC.`,
  };
  await writeFile(resolve(REPO_ROOT, 'artifacts/testnet-deployment.json'), JSON.stringify(record, null, 2) + '\n');
  print({ ok: true, ...record });
});
