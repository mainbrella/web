import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location={hostname:'localhost'} as Location;
const {workspaceMetadata,createWorkspaceClient}=await import('./workspaces-dashboard.ts');
const id='d688d42a-25ef-4c13-9b28-21a0fde6e163';
test('workspace metadata rejects invalid identities and does not retain private fields',()=>{
  const value={id,name:'Saved files',expiresAt:Date.now()+10000,status:'ready',archived:false,size:'small',handle:{id:'private'}};
  assert.equal((workspaceMetadata(value) as unknown as Record<string, unknown>).handle,undefined);
  assert.throws(()=>workspaceMetadata({...value,id:'other-account'}));
  assert.throws(()=>workspaceMetadata({...value,status:'deleted'}));
});
test('save transport preserves recovery keys, includes cookies and forbids redirects',async()=>{
  let seen!: { url: string | URL | Request; options?: RequestInit };const request=createWorkspaceClient({fetcher:async(url,options)=>{seen={url,options};return Response.json({id});}});
  assert.equal((await request('/workspaces','POST',{name:'Saved files'},'recovery-key')).id,id);
  assert.equal(seen.options!.credentials,'include');assert.equal(seen.options!.redirect,'error');
  assert.equal((seen.options!.headers as Record<string, string>)['Idempotency-Key'],'recovery-key');assert.deepEqual(JSON.parse(seen.options!.body as string),{name:'Saved files'});
});
test('authentication failure notifies dashboard and retains public error code',async()=>{
  let notified=false;const request=createWorkspaceClient({onUnauthenticated:()=>{notified=true;},fetcher:async()=>Response.json({error:'not_authenticated'},{status:401})});
  await assert.rejects(request('/workspaces'),/not_authenticated/);assert.equal(notified,true);
});
