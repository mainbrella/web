import type { ClientOptions, Container, ContainerIdentity, PersistenceCapabilities } from './types.ts';
interface Workspace { id: string; name: string; expiresAt: number; status: string; archived: boolean; size: string; bytes?: number }
import { API_ORIGIN } from './auth.ts';

const uuid=(value: unknown)=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function workspaceMetadata(input: unknown): Workspace {
  const value = input as Workspace | null;
  if(!value || !uuid(value.id) || typeof value.name!=='string' || !Number.isSafeInteger(value.expiresAt)
    || !['saving','ready','failed','expired'].includes(value.status) || typeof value.archived!=='boolean' || !['lite','small','medium','large','xl'].includes(value.size))throw new Error('invalid_response');
  return {id:value.id,name:value.name,expiresAt:value.expiresAt,status:value.status,archived:value.archived,size:value.size,bytes:value.bytes};
}
export function createWorkspaceClient({fetcher=fetch,onUnauthenticated,signal}: ClientOptions={}){
  return async(path: string,method='GET',body?: unknown,key?: string)=>{
    const response=await fetcher(`${API_ORIGIN}${path}`,{method,credentials:'include',redirect:'error',
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90_000)]):AbortSignal.timeout(90_000),
      headers:{accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(response.status===401)onUnauthenticated?.();
    const value=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(typeof value?.error==='string'?value.error:'workspaces_unavailable');
    return value;
  };
}

export function createWorkspacesDashboard({onUnauthenticated,onChanged}: { onUnauthenticated: () => void; onChanged: () => Promise<void> }){
  const host=document.querySelector<HTMLElement>('#saved-workspaces')!;
  if(!host)return {configure(_value: PersistenceCapabilities){},attach(_actions: HTMLElement, _container: Container){},setBusy(_value: boolean){},setVisible(_value: boolean){},dispose(){}};
  const rows=host.querySelector<HTMLElement>('ul')!,status=host.querySelector<HTMLElement>('[role="status"]')!,error=host.querySelector<HTMLElement>('[role="alert"]')!;
  const refresh=host.querySelector<HTMLButtonElement>('[data-workspaces-refresh]')!,retry=host.querySelector<HTMLButtonElement>('[data-workspaces-retry]')!;
  const dialog=document.querySelector<HTMLDialogElement>('#workspace-save-dialog')!,form=dialog.querySelector<HTMLFormElement>('form')!,name=form.querySelector<HTMLInputElement>('input[type="text"]')!,stop=form.querySelector<HTMLInputElement>('input[type="checkbox"]')!,submit=form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const dialogError=form.querySelector<HTMLElement>('[role="alert"]')!,dialogStatus=form.querySelector<HTMLElement>('[role="status"]')!;
  const search=host.querySelector<HTMLInputElement>('#workspace-search')!;
  let active=false;
  function filter(){
    let matches=0;
    for(const row of rows.children){const item=row as HTMLElement;item.hidden=!item.dataset.name!.includes(search.value.trim().toLowerCase());if(!item.hidden)matches++;}
    status.textContent=rows.children.length ? (matches ? '' : 'No saved workspaces match your search.') : "You haven't saved any workspaces.";
  }
  search.addEventListener('input',filter);
  const abort=new AbortController(),request=createWorkspaceClient({onUnauthenticated,signal:abort.signal}),restoreKeys=new Map<string, string>();
  let supported=false,canSave=false,externalBusy=false,busy=false,disposed=false,version=0;
  let pending: {container: ContainerIdentity; name: string; stop: boolean; key: string} | null = null, selected: ContainerIdentity | null = null;
  const messages: Record<string, string>={workspace_expired:'This workspace has expired.',workspace_image_incompatible:'This workspace needs an image version that is no longer deployed.',workspace_quota_exceeded:'This save exceeds your saved-workspace count or storage limit. Delete a saved workspace or use a smaller machine.',workspace_save_limit:'You have reached your monthly workspace save limit.',workspace_capture_budget_exceeded:'You have reached your monthly workspace capture budget. Deleting workspaces does not reset it.',workspace_retained_budget_exceeded:'Your workspace capture budget is full until earlier saves age out. Deleting workspaces does not reset it.',workspace_not_ready:'This workspace is unavailable for restore.',workspace_not_found:'This workspace no longer exists.',subscription_required:'An active plan is required to save or restore workspaces.',container_not_running:'This container has stopped or been replaced.'};
  function controls(){
    refresh.disabled=busy||externalBusy||disposed;retry.hidden=!pending;retry.disabled=busy||externalBusy;
    submit.disabled=busy||externalBusy||disposed;submit.textContent=pending?'Retry save':'Save workspace';
    name.disabled=busy||Boolean(pending);stop.disabled=busy||Boolean(pending);
    host.querySelectorAll<HTMLButtonElement>('button[data-workspace-action]').forEach(button=>{button.disabled=busy||externalBusy||button.dataset.unavailable==='true';});
  }
  async function load(){
    if(!supported||busy||disposed)return;const current=++version;status.textContent='Loading saved workspaces…';
    try{const result=await request('/workspaces');if(disposed||current!==version)return;
      if(!Array.isArray(result.workspaces))throw new Error('invalid_response');const workspaces=(result.workspaces as unknown[]).map(workspaceMetadata);
      rows.replaceChildren();status.textContent=workspaces.length?'':"You haven't saved any workspaces.";
      for(const workspace of workspaces){
        const row=document.createElement('li');row.className='container-row';row.dataset.name=workspace.name.toLowerCase();
        const details=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('p');title.textContent=workspace.name;meta.className='dashboard-status';
        meta.textContent=`${workspace.archived?'Archived':workspace.status==='ready'?'Saved':workspace.status==='saving'?'Saving…':workspace.status==='failed'?'Failed':'Expired'} · ${workspace.size.toUpperCase()} · Expires ${new Date(workspace.expiresAt).toLocaleDateString()}`;
        details.append(title,meta);const actions=document.createElement('div');actions.className='container-actions';
        for(const [label,action]of [['Restore','restore'],[workspace.archived?'Unarchive':'Archive','archive'],['Delete','delete']]){
          const button=document.createElement('button');button.type='button';button.className='dashboard-retry';button.textContent=label;button.dataset.workspaceAction=action;
          button.setAttribute('aria-label',`${label} ${workspace.name}`);
          button.dataset.unavailable=String(action==='restore'&&(!canSave||workspace.archived||workspace.status!=='ready'||workspace.expiresAt<=Date.now()));
          button.onclick=()=>operate(workspace,action);actions.append(button);
        }row.append(details,actions);rows.append(row);
      }filter();controls();
    }catch{if(!disposed&&current===version){status.textContent='';error.textContent='Could not load saved workspaces. Refresh to try again.';error.hidden=false;}}
  }
  async function operate(workspace: Workspace,action: string){
    if(busy||externalBusy||disposed)return;
    if(action==='delete'&&!window.confirm(`Delete “${workspace.name}”? You will no longer be able to restore it.`))return;
    busy=true;version++;error.hidden=true;status.textContent=action==='restore'?'Restoring workspace…':'';controls();
    try{
      if(action==='restore'){
        const key=restoreKeys.get(workspace.id)??crypto.randomUUID();restoreKeys.set(workspace.id,key);
        const result=await request('/containers','POST',{workspaceId:workspace.id},key);
        if(result.creation?.status!=='running')throw new Error('restore_pending');restoreKeys.delete(workspace.id);
      }else await request(`/workspaces/${workspace.id}`,action==='delete'?'DELETE':'PATCH',action==='archive'?{archived:!workspace.archived}:undefined);
      if(disposed)return;status.textContent=action==='restore'?'Workspace restored.':action==='delete'?'Workspace deleted.':'Workspace updated.';
    }catch(caught){ const cause = caught instanceof Error ? caught : new Error("Unexpected error");if(!disposed){error.textContent=messages[cause.message]??(action==='restore'?'Restore may have started. Refresh containers before retrying.':'Could not update this workspace. Refresh to check its state.');error.hidden=false;}}
    finally{busy=false;if(!disposed){controls();await onChanged();await load();}}
  }
  function open(container: ContainerIdentity & { name?: string; imageName?: string }){
    selected=pending?pending.container:container;if(!pending){name.value=container.name||container.imageName||'My workspace';stop.checked=false;}
    dialogError.hidden=true;dialogStatus.textContent=pending?'Retry uses the original save request.':'';controls();dialog.showModal();name.focus();
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||externalBusy||disposed||!selected||!form.reportValidity())return;
    if(!pending&&!name.value.trim()){dialogError.textContent='Enter a workspace name.';dialogError.hidden=false;name.focus();return;}
    pending??={container:{id:selected.id,createdAt:selected.createdAt},name:name.value.trim(),stop:stop.checked,key:crypto.randomUUID()};
    busy=true;dialogError.hidden=true;dialogStatus.textContent='Saving filesystem…';controls();
    try{
      const result=await request('/workspaces','POST',{...pending.container,name:pending.name,stop:pending.stop},pending.key);workspaceMetadata(result);
      if(disposed)return;pending=null;dialog.close();status.textContent='Workspace saved.';
    }catch(caught){ const cause = caught instanceof Error ? caught : new Error("Unexpected error");if(!disposed){dialogStatus.textContent='';dialogError.textContent=messages[cause.message]??'Save could not be confirmed. Retry this request or refresh saved workspaces to check its state.';dialogError.hidden=false;}}
    finally{busy=false;if(!disposed){controls();await onChanged();await load();}}
  };
  form.querySelector<HTMLButtonElement>('[data-workspace-cancel]')!.onclick=()=>dialog.close();retry.onclick=()=>{ if (pending) open(pending.container); };refresh.onclick=()=>{error.hidden=true;load();};
  return {
    configure(value: PersistenceCapabilities={}){const next=value.workspaces===true||value.snapshots===true;canSave=value.snapshots===true;search.disabled=!next;host.hidden=!active;if(!next)status.textContent='Saved workspaces are unavailable in this environment.';if(next&&!supported){supported=true;load();}else supported=next;controls();},
    attach(actions: HTMLElement,container: Container){if(!canSave)return;const button=document.createElement('button');button.type='button';button.className='dashboard-retry';button.textContent='Save workspace';button.dataset.action='save-workspace';button.dataset.requiresRunning='true';button.dataset.running=String(container.status==='running');button.onclick=()=>{if(!busy&&!externalBusy)open(container);};actions.append(button);},
    setVisible(value: boolean){active=value;host.hidden=!active;if(!supported)status.textContent='Saved workspaces are unavailable in this environment.';},
    setBusy(value: boolean){externalBusy=value;controls();},
    dispose(){disposed=true;version++;abort.abort();pending=null;restoreKeys.clear();dialog.close();rows.replaceChildren();host.hidden=true;},
  };
}
