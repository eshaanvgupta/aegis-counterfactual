/**
 * Replace the vault's code without re-initializing (state is preserved).
 *
 *   pnpm testnet:upgrade
 *
 * Only for state-compatible builds of the same contract. Signed by the VAULT key. This
 * is a deliberate, documented trust assumption of the testnet prototype: whoever holds
 * the vault account's full-access key can replace its code. Production deployments
 * should remove that key (or move upgrades behind a multisig/DAO) after deployment.
 */
import { actions } from 'near-api-js';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  REPO_ROOT, accountId, main, print, provider, readJson, recordEvidence, signingAccount, toEvidence, view, type OutcomeLike,
} from '../packages/near-client/src/index.js';
import { base58 } from './lib/testnet.js';

await main(async () => {
  const code = await readFile(resolve(REPO_ROOT, 'artifacts/aegis_vault.wasm'));
  const build = await readJson<{ sha256: string }>(resolve(REPO_ROOT, 'artifacts/contract-build.json'));
  const sha = createHash('sha256').update(code).digest('hex');
  if (sha !== build.sha256) throw new Error('Artifact does not match contract-build.json. Run pnpm build:contract.');
  const vaultId = accountId('VAULT');
  const before = await view<{ contract_version: string; intent_count: string }>('get_vault_status');
  if (!before?.contract_version) throw new Error('The account does not run the AEGIS vault; use pnpm testnet:deploy instead.');
  const previous = (await provider().viewAccount({ accountId: vaultId })).code_hash;
  const expected = base58(createHash('sha256').update(code).digest());
  if (previous === expected) {
    print({ ok: true, unchanged: true, code_hash: previous });
    return;
  }
  const signer = await signingAccount('VAULT');
  const outcome = await signer.signAndSendTransaction({ receiverId: vaultId, actions: [actions.deployContract(code)], waitUntil: 'FINAL', throwOnFailure: false });
  const evidence = await recordEvidence(toEvidence('Upgrade vault code (state preserved)', 'VAULT', 'deploy_code', outcome as unknown as OutcomeLike));
  if (!evidence.succeeded) throw new Error(`Upgrade failed: ${evidence.failure}`);
  const deployed = (await provider().viewAccount({ accountId: vaultId })).code_hash;
  if (deployed !== expected) throw new Error(`On-chain code hash ${deployed} != local ${expected}`);
  const after = await view<{ intent_count: string }>('get_vault_status');
  if (after.intent_count !== before.intent_count) throw new Error('State changed unexpectedly during upgrade');
  const file = resolve(REPO_ROOT, 'artifacts/testnet-deployment.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.upgrades = [...(record.upgrades ?? []), { at: evidence.timestamp, transaction_hash: evidence.transaction_hash, explorer_url: evidence.explorer_url, previous_code_hash: previous, code_hash: deployed, wasm_sha256: sha, reason: 'Rebuild with --cfg near so contract panics surface their messages on-chain' }];
  record.code_hash = deployed;
  record.wasm_sha256 = sha;
  record.wasm_bytes = code.length;
  await writeFile(file, JSON.stringify(record, null, 2) + '\n');
  print({ ok: true, transaction_hash: evidence.transaction_hash, previous_code_hash: previous, code_hash: deployed, state_preserved: true });
});
