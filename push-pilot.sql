-- 知行记：最小后台推送实验。先执行本脚本，再部署同名 Edge Function。
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table if not exists public.zxj_push_pilot_config (
 id boolean primary key default true check(id),
 worker_secret text not null default gen_random_uuid()::text,
 vapid jsonb
);
insert into public.zxj_push_pilot_config(id) values(true) on conflict do nothing;
create table if not exists public.zxj_push_pilot_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null,
 due_at timestamptz not null default now()+interval '2 minutes',
 created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','sending','accepted','failed','unknown')),
 error text, sent_at timestamptz
);
create unique index if not exists zxj_push_pilot_one_pending on public.zxj_push_pilot_jobs(user_id) where state in ('pending','sending');
alter table public.zxj_push_pilot_config enable row level security;
alter table public.zxj_push_pilot_jobs enable row level security;
revoke all on public.zxj_push_pilot_config,public.zxj_push_pilot_jobs from public,anon,authenticated;
grant all on public.zxj_push_pilot_config,public.zxj_push_pilot_jobs to service_role;
create or replace function public.zxj_push_pilot_claim()
returns setof public.zxj_push_pilot_jobs language plpgsql security definer set search_path='' as $$
begin
 update public.zxj_push_pilot_jobs set state='unknown',error='发送进程中断，请重新测试' where state='sending' and sent_at<now()-interval '5 minutes';
 return query update public.zxj_push_pilot_jobs j set state='sending',sent_at=now()
 where j.id in(select q.id from public.zxj_push_pilot_jobs q where q.state='pending' and q.due_at<=now() order by q.due_at for update skip locked limit 5) returning j.*;
end $$;
revoke all on function public.zxj_push_pilot_claim() from public,anon,authenticated;
grant execute on function public.zxj_push_pilot_claim() to service_role;
create or replace function public.zxj_push_pilot_tick()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.zxj_push_pilot_jobs where created_at<now()-interval '7 days';
 if not exists(select 1 from public.zxj_push_pilot_jobs where state in ('pending','sending') and due_at<=now()) then return; end if;
 perform net.http_post(
   url:='https://xpspmpgicjdtmmclzbuo.supabase.co/functions/v1/zxj-push-pilot',
   headers:=jsonb_build_object('Content-Type','application/json','x-zxj-worker',(select worker_secret from public.zxj_push_pilot_config where id)),
   body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=10000
 );
end $$;
revoke all on function public.zxj_push_pilot_tick() from public,anon,authenticated;
-- HTTP 队列含工作密钥，不允许浏览器角色读取。
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;
do $$ begin
 if exists(select 1 from cron.job where jobname='zxj-push-pilot') then perform cron.unschedule('zxj-push-pilot'); end if;
 perform cron.schedule('zxj-push-pilot','* * * * *','select public.zxj_push_pilot_tick();');
end $$;
commit;
