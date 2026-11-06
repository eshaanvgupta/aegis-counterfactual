/** Explicitly create disposable identities using the official free testnet faucet.
 * Never imports an existing wallet or reads .env. Private material stays in ignored runtime/.
 */
import { Account, JsonRpcProvider, KeyPair, PublicKey, actions, type KeyPairString } from 'near-api-js';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory=resolve('runtime/dev-credentials');
const manifestPath=resolve(directory,'manifest.json');
const rpcUrl='https://test.rpc.fastnear.com';
const faucetUrl='https://helper.nearprotocol.com/account';
const provider=new JsonRpcProvider({url:rpcUrl},{retries:2,wait:500,backoff:2});
type Credential={account_id:string;public_key:string;private_key:KeyPairString;permission:string};
type Manifest={network_id:'testnet';rpc_url:string;faucet_url:string;created_at:string;roles:Record<string,{account_id:string;public_key:string;permission:string}>;faucet_requested?:boolean;faucet_result?:unknown;transactions:unknown[]};
const write=async(file:string,value:unknown)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=async<T>(file:string):Promise<T>=>JSON.parse(await readFile(file,'utf8'));
const publicOutcome=(operation:string,result:any)=>({operation,transaction_hash:result.transaction?.hash,signer_id:result.transaction?.signer_id,receiver_id:result.transaction?.receiver_id,status:result.status,receipt_failures:(result.receipts_outcome??[]).map((r:any)=>r.outcome.status).filter((s:any)=>s&&typeof s==='object'&&'Failure'in s),explorer_url:`https://testnet.nearblocks.io/txns/${result.transaction?.hash}`});

async function main(){
  if(!process.argv.includes('--create'))throw new Error('This command creates free disposable NEAR testnet identities. Explicit usage: pnpm exec tsx scripts/provision-testnet.ts --create');
  const status=await provider.viewNodeStatus();
  if(status.chain_id!=='testnet')throw new Error('RPC is not NEAR testnet; refusing account creation');
  await mkdir(directory,{recursive:true,mode:0o700});
  let manifest:Manifest;
  if(existsSync(manifestPath))manifest=await read<Manifest>(manifestPath);
  else{
    const suffix=Date.now().toString(36)+'-'+randomBytes(3).toString('hex');
    const owner=`aegis-cf-${suffix}.testnet`;
    const ids:Record<string,string>={OWNER:owner,VAULT:`vault.${owner}`,AGENT:`agent.${owner}`,ATTESTOR:`attestor.${owner}`,RECIPIENT:`vendor.${owner}`};
    manifest={network_id:'testnet',rpc_url:rpcUrl,faucet_url:faucetUrl,created_at:new Date().toISOString(),roles:{},transactions:[]};
    for(const [role,id]of Object.entries(ids)){
      const pair=KeyPair.fromRandom('ed25519');
      const permission=['AGENT','ATTESTOR'].includes(role)?'FunctionCall':'FullAccess';
      const credential:Credential={account_id:id,public_key:pair.getPublicKey().toString(),private_key:pair.toString() as KeyPairString,permission};
      await write(resolve(directory,role.toLowerCase()+'.json'),credential);
      manifest.roles[role]={account_id:id,public_key:credential.public_key,permission};
      if(permission==='FunctionCall'){
        const admin=KeyPair.fromRandom('ed25519');
        await write(resolve(directory,role.toLowerCase()+'-admin.json'),{account_id:id,public_key:admin.getPublicKey().toString(),private_key:admin.toString(),permission:'FullAccess recovery; never passed to service'});
      }
    }
    await write(manifestPath,manifest);
  }
  if(manifest.network_id!=='testnet'||manifest.rpc_url!==rpcUrl)throw new Error('Unexpected credential manifest network');
  let ownerExists=false;
  try{await provider.viewAccount({accountId:manifest.roles.OWNER.account_id});ownerExists=true;}catch(error){if(!/UNKNOWN_ACCOUNT|does not exist at block height/.test(String(error)))throw error;}
  if(!ownerExists){
    if(manifest.faucet_requested)throw new Error('Faucet was already requested for this identity. Inspect the saved public result; no duplicate request sent.');
    manifest.faucet_requested=true;
    await write(manifestPath,manifest);
    const response=await fetch(faucetUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({newAccountId:manifest.roles.OWNER.account_id,newAccountPublicKey:manifest.roles.OWNER.public_key}),signal:AbortSignal.timeout(30000),redirect:'error'});
    const text=await response.text();
    let result:unknown;
    try{result=JSON.parse(text);}catch{result=text.slice(0,1500);}
    manifest.faucet_result={http_status:response.status,result};
    await write(manifestPath,manifest);
    if(!response.ok)throw new Error(`Official faucet returned HTTP ${response.status}; saved response in ignored manifest. No alternate identity or quota evasion attempted.`);
    // Wait only for visibility of this one faucet result; never repeat account creation.
    for(let attempt=0;attempt<8;attempt++){
      try{await provider.viewAccount({accountId:manifest.roles.OWNER.account_id});ownerExists=true;break;}catch{await new Promise(r=>setTimeout(r,1000));}
    }
    if(!ownerExists)throw new Error('Faucet response received but account is not yet visible. Run again later; saved request is reused.');
  }
  const ownerCredential=await read<Credential>(resolve(directory,'owner.json'));
  const owner=new Account(ownerCredential.account_id,provider,ownerCredential.private_key);
  const account=await provider.viewAccount({accountId:ownerCredential.account_id});
  const required=8n*10n**24n;
  const missing:string[]=[];
  for(const role of ['VAULT','AGENT','ATTESTOR','RECIPIENT']){
    try{await provider.viewAccount({accountId:manifest.roles[role].account_id});}catch(error){if(!/UNKNOWN_ACCOUNT|does not exist at block height/.test(String(error)))throw error;missing.push(role);}
  }
  if(missing.length===4&&BigInt(account.amount)<required)throw new Error('Faucet funding is below 8 testnet NEAR, insufficient for this WASM storage and principals. No real funds requested.');
  for(const role of missing){
    const cred=await read<Credential>(resolve(directory,role.toLowerCase()+'.json'));
    const amount=role==='VAULT'?7n*10n**24n:role==='RECIPIENT'?10n**23n:3n*10n**23n;
    const pubkey=PublicKey.fromString(cred.public_key);
    const addKey=role==='AGENT'?actions.addFunctionCallAccessKey(pubkey,manifest.roles.VAULT.account_id,['submit_intent','execute_intent'],2n*10n**23n):role==='ATTESTOR'?actions.addFunctionCallAccessKey(pubkey,manifest.roles.VAULT.account_id,['attest_intent'],2n*10n**23n):actions.addFullAccessKey(pubkey);
    const txActions=[actions.createAccount(),actions.transfer(amount),addKey];
    if(['AGENT','ATTESTOR'].includes(role)){
      const recovery=await read<Credential>(resolve(directory,role.toLowerCase()+'-admin.json'));
      txActions.push(actions.addFullAccessKey(PublicKey.fromString(recovery.public_key)));
    }
    const outcome=await owner.signAndSendTransaction({receiverId:cred.account_id,actions:txActions,waitUntil:'FINAL',throwOnFailure:false});
    const evidence=publicOutcome(`CREATE_${role}`,outcome);
    manifest.transactions.push(evidence);await write(manifestPath,manifest);
    if(evidence.receipt_failures.length||!('SuccessValue'in(outcome.status as object)))throw new Error(`Failed to create ${role}; public outcome saved. No repeated transfer attempted.`);
    console.log(JSON.stringify(evidence));
  }
  await mkdir(resolve('artifacts'),{recursive:true});
  const publicManifest={network_id:manifest.network_id,rpc_url:manifest.rpc_url,faucet_url:manifest.faucet_url,created_at:manifest.created_at,roles:manifest.roles,transactions:manifest.transactions,credentials:'Ignored runtime/dev-credentials; never commit or publish'};
  await write(resolve('artifacts/testnet-accounts.json'),publicManifest);
  console.log(JSON.stringify({ok:true,...publicManifest},null,2));
}
try{await main();}catch(error){console.error(JSON.stringify({ok:false,error:(error instanceof Error?error.message:'Provisioning failure').replace(/ed25519:[A-Za-z0-9]+/g,'[REDACTED_KEY]').slice(0,2000)}));process.exitCode=1;}
