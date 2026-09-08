-- 知行记：持续后台事项推送。执行本脚本，再部署 zxj-push-reminders。
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table if not exists public.zxj_push_reminders_config (
 id boolean primary key default true check(id),
 worker_secret text not null default gen_random_uuid()::text,
 vapid jsonb
);
insert into public.zxj_push_reminders_config(id) values(true) on conflict do nothing;
create table if not exists public.zxj_push_reminders_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null,
 due_at timestamptz not null default now()+interval '2 minutes',
 created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','sending','accepted','failed','unknown')),
 error text, sent_at timestamptz
);
alter table public.zxj_push_reminders_jobs add column if not exists todo_id text;
alter table public.zxj_push_reminders_jobs add column if not exists event_key text;
alter table public.zxj_push_reminders_jobs add column if not exists device_id text;
alter table public.zxj_push_reminders_jobs add column if not exists title text;
create unique index if not exists zxj_push_reminders_event on public.zxj_push_reminders_jobs(user_id,device_id,event_key);
create table if not exists public.zxj_push_reminders_subscriptions (
 user_id uuid not null references auth.users(id) on delete cascade,
 device_id text not null, subscription jsonb not null,
 enabled_at timestamptz not null default now(),
 primary key(user_id,device_id)
);
alter table public.zxj_push_reminders_subscriptions enable row level security;
revoke all on public.zxj_push_reminders_subscriptions from public,anon,authenticated;
grant all on public.zxj_push_reminders_subscriptions to service_role;
alter table public.zxj_push_reminders_config enable row level security;
alter table public.zxj_push_reminders_jobs enable row level security;
revoke all on public.zxj_push_reminders_config,public.zxj_push_reminders_jobs from public,anon,authenticated;
grant all on public.zxj_push_reminders_config,public.zxj_push_reminders_jobs to service_role;
create or replace function public.zxj_push_reminders_claim()
returns setof public.zxj_push_reminders_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.zxj_push_reminders_jobs set state='unknown',error='发送进程中断，请重新测试' where state='sending' and sent_at<now()-interval '5 minutes';
 update public.zxj_push_reminders_jobs set state='failed',error='已过发送窗口，不补发'
 where state='pending' and due_at<now()-interval '2 minutes';
 return query update public.zxj_push_reminders_jobs j set state='sending',sent_at=now()
 where j.id in(select q.id from public.zxj_push_reminders_jobs q where q.state='pending' and q.due_at<=now() order by q.due_at for update skip locked limit 5) returning j.*;
end $$;
revoke all on function public.zxj_push_reminders_claim() from public,anon,authenticated;
grant execute on function public.zxj_push_reminders_claim() to service_role;
create or replace function public.zxj_push_reminders_tick()
returns void language plpgsql security definer set search_path='' as $$
declare s record; t jsonb; ev record; v_stamp timestamptz; v_value text;
begin
 if not pg_try_advisory_xact_lock(7729148203) then return; end if;
 for s in select sub.*,sync.data from public.zxj_push_reminders_subscriptions sub
 join public.zxj_sync sync on sync.user_id=sub.user_id and sync.id='main' loop
  for t in select value from jsonb_array_elements(s.data->'todos') loop
   begin
    if coalesce(t->>'done','false')<>'false' then continue;end if;
    for ev in select 'reminder' as kind,t->>'reminder' as value
     union all select 'due',(t->>'date')||' '||coalesce(nullif(t->>'time',''),'09:00') loop
     v_value:=replace(ev.value,'T',' ');
     if v_value is null or v_value !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then continue;end if;
     v_stamp:=v_value::timestamp at time zone 'Asia/Shanghai';
     if v_stamp>now() or v_stamp<now()-interval '2 minutes' or v_stamp<s.enabled_at then continue;end if;
     insert into public.zxj_push_reminders_jobs(user_id,device_id,subscription,due_at,todo_id,event_key,title)
     values(s.user_id,s.device_id,s.subscription,v_stamp,t->>'id',(t->>'id')||'|'||ev.kind||'|'||ev.value,t->>'title')
     on conflict(user_id,device_id,event_key) do nothing;
    end loop;
   exception when invalid_datetime_format or datetime_field_overflow then continue;
   end;
  end loop;
 end loop;
 delete from public.zxj_push_reminders_jobs where created_at<now()-interval '7 days';
 if not exists(select 1 from public.zxj_push_reminders_jobs where state in ('pending','sending') and due_at<=now()) then return; end if;
 perform net.http_post(
   url:='https://xpspmpgicjdtmmclzbuo.supabase.co/functions/v1/zxj-push-reminders',
   headers:=jsonb_build_object('Content-Type','application/json','x-zxj-worker',(select worker_secret from public.zxj_push_reminders_config where id)),
   body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=10000
 );
end $$;
revoke all on function public.zxj_push_reminders_tick() from public,anon,authenticated;
-- HTTP 队列含工作密钥，不允许浏览器角色读取。
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;
do $$ begin
 if exists(select 1 from cron.job where jobname='zxj-push-reminders') then perform cron.unschedule('zxj-push-reminders'); end if;
 perform cron.schedule('zxj-push-reminders','* * * * *','select public.zxj_push_reminders_tick();');
end $$;
commit;

