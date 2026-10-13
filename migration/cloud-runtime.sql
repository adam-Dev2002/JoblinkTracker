-- Runtime helpers for Vercel APIs. Additive: preserves imported records.
create table if not exists public.joblink_feed_cache (
 cache_key text primary key,
 payload jsonb not null,
 expires_at timestamptz not null
);
alter table public.joblink_feed_cache enable row level security;
revoke all on public.joblink_feed_cache from anon,authenticated;
grant all on public.joblink_feed_cache to service_role;
create or replace function public.joblink_hit_limit(p_key text,p_window bigint) returns integer
language plpgsql security definer set search_path=public as $$
declare total integer;
begin
 insert into public.auth_attempts(attempt_key,window_id,attempts) values(p_key,p_window,1)
 on conflict(attempt_key,window_id) do update set attempts=auth_attempts.attempts+1 returning attempts into total;
 delete from public.auth_attempts where window_id<p_window-1;
 return total;
end;
$$;
revoke all on function public.joblink_hit_limit(text,bigint) from public,anon,authenticated;
grant execute on function public.joblink_hit_limit(text,bigint) to service_role;
create or replace function public.joblink_workspace_write(p_user bigint,p_action text,p_id bigint,p_kind text,p_payload jsonb,p_ids bigint[] default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare existing public.workspace_items; updated jsonb; affected bigint[]; result jsonb; title text; tasks jsonb;
begin
 if p_action is null or p_action not in ('save','delete','bulk-delete','delete-status') then raise exception 'Invalid action';end if;
 perform id from public.users where id=p_user for update;
 if not found then raise exception 'Account not found'; end if;
 if p_action='bulk-delete' then
  if coalesce(p_kind,'') not in ('','application','sheet') then raise exception 'Invalid bulk-delete entry type'; end if;
  select array_agg(id) into affected from public.workspace_items where user_id=p_user and kind=coalesce(nullif(p_kind,''),'sheet') and id=any(p_ids);
  if coalesce(cardinality(affected),0)<>coalesce(cardinality(p_ids),0) then raise exception 'Entry not found'; end if;
  delete from public.workspace_items where user_id=p_user and id=any(affected);
  return jsonb_build_object('deleted',to_jsonb(affected));
 end if;
 if p_action in ('delete','delete-status') then
  select * into existing from public.workspace_items where id=p_id and user_id=p_user;
  if not found then raise exception 'Entry not found'; end if;
  if p_action='delete-status' then
   if existing.kind<>'task_status' then raise exception 'Status not found'; end if;
   with changes as (update public.workspace_items set payload=jsonb_set(payload,'{status}','"To do"') where user_id=p_user and kind='task' and payload->>'status'=existing.payload->>'title' returning id,kind,payload)
   select coalesce(jsonb_agg(to_jsonb(changes)),'[]') into tasks from changes;
  elsif existing.kind='task_status' then raise exception 'Use delete-status'; end if;
  delete from public.workspace_items where id=p_id and user_id=p_user;
  return case when p_action='delete-status' then jsonb_build_object('deleted',p_id,'updated',tasks) else jsonb_build_object('ok',true) end;
 end if;
 if p_kind not in ('application','task','task_status','event','link','sheet') then raise exception 'Invalid entry kind'; end if;
 if p_kind='application' and (p_payload->>'status' is null or p_payload->>'status' not in ('Saved','Unavailable','Applied','Interview','Offer','Rejected','Ghosted')) then raise exception 'Invalid application status';end if;
 title:=btrim(p_payload->>'title');if coalesce(title,'')='' then raise exception 'A title is required';end if;
 if p_kind='task_status' then
  if p_id>0 or length(title)>40 then raise exception 'Invalid status name'; end if;
  if lower(title) in ('to do','in progress','done') or exists(select 1 from public.workspace_items where user_id=p_user and kind='task_status' and lower(payload->>'title')=lower(title)) then raise exception 'Status already exists'; end if;
  if (select count(*) from public.workspace_items where user_id=p_user and kind='task_status')>=12 then raise exception 'Status limit reached'; end if;
 end if;
 if p_kind='task' and p_payload->>'status' not in ('To do','In progress','Done') and not exists(select 1 from public.workspace_items where user_id=p_user and kind='task_status' and payload->>'title'=p_payload->>'status') then raise exception 'Invalid task status';end if;
 if p_id>0 then
  update public.workspace_items set payload=p_payload where id=p_id and user_id=p_user and kind=p_kind returning * into existing;
  if not found then raise exception 'Entry not found';end if;
 else
  if (select count(*) from public.workspace_items where user_id=p_user)>=2000 then raise exception 'Workspace limit reached';end if;
  insert into public.workspace_items(user_id,kind,payload) values(p_user,p_kind,p_payload) returning * into existing;
 end if;
 return jsonb_build_object('item',jsonb_build_object('id',existing.id,'kind',existing.kind,'payload',existing.payload));
end;
$$;
revoke all on function public.joblink_workspace_write(bigint,text,bigint,text,jsonb,bigint[]) from public,anon,authenticated;
grant execute on function public.joblink_workspace_write(bigint,text,bigint,text,jsonb,bigint[]) to service_role;
