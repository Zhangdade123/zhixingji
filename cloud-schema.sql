-- 知行记 V2 同步表。执行前导出数据；脚本遇到无归属旧行会停止，不会删除它们。
begin;
create table if not exists public.zxj_sync (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  rev bigint not null default 0,
  device text,
  updated_at timestamptz not null default now(),
  primary key(id,user_id)
);
alter table public.zxj_sync add column if not exists user_id uuid references auth.users(id) on delete cascade;
do $migration$
begin
  if exists(select 1 from public.zxj_sync where user_id is null) then
    raise exception '存在无账号归属的历史数据。请先导出并明确每行所属账号，再迁移；本脚本未删除任何历史数据。';
  end if;
end;
$migration$;
alter table public.zxj_sync alter column user_id set not null;
alter table public.zxj_sync drop constraint if exists zxj_sync_pkey;
alter table public.zxj_sync add constraint zxj_sync_pkey primary key(id,user_id);
alter table public.zxj_sync enable row level security;
drop policy if exists "zxj anon all" on public.zxj_sync;
drop policy if exists "zxj owner all" on public.zxj_sync;
create policy "zxj owner all" on public.zxj_sync for all to authenticated
using (auth.uid()=user_id) with check(auth.uid()=user_id);
revoke all on public.zxj_sync from anon;
grant select,insert,update,delete on public.zxj_sync to authenticated;
notify pgrst, 'reload schema';
commit;
