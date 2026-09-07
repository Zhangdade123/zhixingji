-- 知行记 V2 邮件 outbox。需先有 public.zxj_sync。
-- 仅在用户部署本脚本后启用；网页不会自动执行 SQL。
-- 网页选择后端模式后，以此队列为唯一调度者。
-- 服务接受不等于收件箱实际送达；不确定的请求不自动重发，避免重复邮件。
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- pg_net 请求队列包含收件地址与材料，不对匿名/普通登录客户端开放。
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;
create schema if not exists zxj_private;
revoke all on schema zxj_private from public,anon,authenticated;
create table if not exists zxj_private.mail_outbox (
  user_id uuid not null references auth.users(id) on delete cascade,
  todo_id text not null,
  kind text not null check(kind in ('reminder','due')),
  occurrence text not null,
  due_at timestamptz not null,
  state text not null default 'pending' check(state in ('pending','queued','accepted','failed','unknown','cancelled')),
  attempts integer not null default 0,
  request_id bigint,
  requested_at timestamptz,
  retry_at timestamptz not null default now(),
  error text,
  updated_at timestamptz not null default now(),
  primary key(user_id,todo_id,kind,occurrence)
);
alter table zxj_private.mail_outbox enable row level security;
revoke all on zxj_private.mail_outbox from public,anon,authenticated;

create or replace function zxj_private.scan_and_mail()
returns void language plpgsql security definer set search_path='' as $body$
declare
  s record; t jsonb; ev record; q record; cfg jsonb; recipient text;
  stamp timestamptz; v_occurrence text; response record; req bigint;
begin
  -- 同一事务只允许一个扫描器运行。
  if not pg_try_advisory_xact_lock(7729148201) then return; end if;

  -- 回收异步结果。明确未被限流接受的 429 才自动重试。
  for q in select * from zxj_private.mail_outbox where state='queued' for update skip locked loop
    select status_code,timed_out,error_msg into response from net._http_response where id=q.request_id;
    if found then
      update zxj_private.mail_outbox set
        state=case when response.status_code between 200 and 299 then 'accepted'
          when response.status_code=429 and attempts<5 then 'pending'
          when response.timed_out or response.status_code is null or response.status_code>=500 then 'unknown'
          else 'failed' end,
        retry_at=now()+interval '1 minute'*power(2,least(attempts,5)),
        error=case when response.status_code between 200 and 299 then null else coalesce(response.error_msg,'HTTP '||response.status_code::text,'结果不确定') end,
        updated_at=now()
      where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;
    elsif q.requested_at<now()-interval '10 minutes' then
      update zxj_private.mail_outbox set state='unknown',error='10 分钟未找到响应；请核验服务端记录后人工决定是否重发',updated_at=now()
      where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;
    end if;
  end loop;

  for s in select user_id,data from public.zxj_sync where id='main' loop
    if s.data#>>'{settings,mailOn}' is distinct from 'true' then continue; end if;
    if jsonb_typeof(s.data->'todos') is distinct from 'array' then continue; end if;
    for t in select value from jsonb_array_elements(s.data->'todos') loop
      begin
        if t->>'priority' is distinct from 'high' or coalesce(t->>'done','false')<>'false' then continue; end if;
        for ev in select 'reminder'::text as kind,t->>'reminder' as value,t->>'_mailRemindSent' as legacy
          union all select 'due',(t->>'date')||' '||coalesce(nullif(t->>'time',''),'09:00'),t->>'_mailDueSent'
        loop
          v_occurrence:=replace(ev.value,'T',' ');
          if v_occurrence is null or v_occurrence !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then continue; end if;
          stamp:=v_occurrence::timestamp at time zone 'Asia/Shanghai';
          -- 部署/恢复任务时不补发历史逾期；与网页的 5 分钟窗口一致。
          if stamp>now() or stamp<now()-interval '5 minutes' then continue; end if;
          insert into zxj_private.mail_outbox(user_id,todo_id,kind,occurrence,due_at,state,error)
          values(s.user_id,t->>'id',ev.kind,v_occurrence,stamp,
            case when replace(ev.legacy,'T',' ')=v_occurrence then 'accepted' else 'pending' end,
            case when replace(ev.legacy,'T',' ')=v_occurrence then '沿用旧版发送标记，旧版无法验证实际送达' else null end)
          on conflict(user_id,todo_id,kind,occurrence) do update
            set state='pending',retry_at=now(),error=null,updated_at=now()
            where zxj_private.mail_outbox.state='cancelled';
        end loop;
      exception when others then
        raise warning '跳过损坏事项 % / %: %',s.user_id,t->>'id',sqlerrm;
      end;
    end loop;
  end loop;

  update zxj_private.mail_outbox set state='cancelled',error='已超过 5 分钟发送窗口，不补发历史邮件',updated_at=now()
    where state='pending' and due_at<now()-interval '5 minutes';
  -- 限速：每次扫描最多处理 1 封，避开 EmailJS 并发/每秒发送限制。
  for q in select * from zxj_private.mail_outbox where state='pending' and retry_at<=now()
    order by due_at limit 1 for update skip locked loop
    begin
      select data into cfg from public.zxj_sync where user_id=q.user_id and id='main' for share;
      if cfg is null or cfg#>>'{settings,mailOn}' is distinct from 'true' then
        update zxj_private.mail_outbox set state='cancelled',error='邮件开关已关闭',updated_at=now()
        where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;continue;
      end if;
      select value into t from jsonb_array_elements(cfg->'todos') where value->>'id'=q.todo_id;
      v_occurrence:=case when q.kind='reminder' then replace(t->>'reminder','T',' ') else (t->>'date')||' '||coalesce(nullif(t->>'time',''),'09:00') end;
      if t is null or coalesce(t->>'done','false')<>'false' or t->>'priority' is distinct from 'high' or v_occurrence is distinct from q.occurrence then
        update zxj_private.mail_outbox set state='cancelled',error='事项已完成、删除或改期',updated_at=now()
        where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;continue;
      end if;
      recipient:=nullif(cfg#>>'{settings,mail,to}','');
      if recipient is null then select email into recipient from auth.users where id=q.user_id;end if;
      cfg:=cfg#>'{settings,mail}';
      if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or coalesce(cfg->>'serviceId','')='' or coalesce(cfg->>'templateId','')='' or coalesce(cfg->>'publicKey','')='' then
        update zxj_private.mail_outbox set state='failed',error='邮件通道或收件人未配置',updated_at=now()
        where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;continue;
      end if;
      req:=net.http_post(url:='https://api.emailjs.com/api/v1.0/email/send',headers:='{"Content-Type":"application/json"}'::jsonb,
        body:=jsonb_build_object('service_id',cfg->>'serviceId','template_id',cfg->>'templateId','user_id',cfg->>'publicKey',
          'template_params',jsonb_build_object('to_email',recipient,'to_name',recipient,
            'subject','【知行记】'||coalesce(t->>'title','未命名事项'),
            'title','【知行记】'||coalesce(t->>'title','未命名事项'),
            'message','事项「'||coalesce(t->>'title','未命名事项')||'」已到'||case when q.kind='due' then '截止' else '提醒' end||'时间：'||q.occurrence||'（北京时间）。请及时处理。')),
        timeout_milliseconds:=10000);
      update zxj_private.mail_outbox set state='queued',attempts=attempts+1,request_id=req,requested_at=now(),updated_at=now()
      where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;
    exception when others then
      update zxj_private.mail_outbox set state='failed',error=sqlerrm,updated_at=now()
      where user_id=q.user_id and todo_id=q.todo_id and kind=q.kind and occurrence=q.occurrence;
    end;
  end loop;
end;
$body$;
revoke all on function zxj_private.scan_and_mail() from public,anon,authenticated;
-- 只撤销旧函数公开执行权限，不删除旧数据。
do $migration$
begin
  if to_regprocedure('public.zxj_scan_and_mail()') is not null then
    execute 'revoke all on function public.zxj_scan_and_mail() from public, anon, authenticated';
  end if;
  if exists(select 1 from cron.job where jobname='zxj_mail_every_minute') then perform cron.unschedule('zxj_mail_every_minute');end if;
  if exists(select 1 from cron.job where jobname='zxj_mail_v2') then perform cron.unschedule('zxj_mail_v2');end if;
end;
$migration$;
select cron.schedule('zxj_mail_v2','* * * * *','select zxj_private.scan_and_mail();');
commit;
-- 只读验收：
-- select jobname,active,command from cron.job where jobname='zxj_mail_v2';
-- select status,return_message,start_time from cron.job_run_details order by start_time desc limit 10;
-- select state,count(*) from zxj_private.mail_outbox group by state;
-- unknown/failed 需先核验 EmailJS 记录，不能盲目重试。accepted 只代表 EmailJS 接受请求。
