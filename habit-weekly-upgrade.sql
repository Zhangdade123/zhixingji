create or replace function public.zxj_habit_reminder_time(h jsonb,day date)
returns text language sql immutable set search_path='' as $$
 select case when value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then value else null end
 from (select case when h->'reminderWeek' is not null and h->'reminderWeek'<>'null'::jsonb
  then case when jsonb_typeof(h->'reminderWeek')='object' then h->'reminderWeek'->>extract(isodow from day)::int::text else null end
  else h->>'reminderTime' end as value) v;
$$;
revoke all on function public.zxj_habit_reminder_time(jsonb,date) from public,anon,authenticated;
grant execute on function public.zxj_habit_reminder_time(jsonb,date) to service_role;
create or replace function public.zxj_push_reminders_tick()
returns void language plpgsql security definer set search_path='' as $$
declare s record; t jsonb; ev record; v_stamp timestamptz; v_value text; v_day date;
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
  for t in select value from jsonb_array_elements(coalesce(s.data->'habits','[]'::jsonb)) loop
   begin
    if coalesce(t->>'archived','false')<>'false' then continue;end if;
    -- Include yesterday so 23:59 reminders survive the midnight scan boundary.
    for v_day in select (now() at time zone 'Asia/Shanghai')::date union all select (now() at time zone 'Asia/Shanghai')::date-1 loop
     if coalesce(t->'checkins'->>to_char(v_day,'YYYY-MM-DD'),'false')='true' then continue;end if;
     v_value:=public.zxj_habit_reminder_time(t,v_day);
     if v_value is null then continue;end if;
     v_value:=to_char(v_day,'YYYY-MM-DD')||' '||v_value;
     v_stamp:=v_value::timestamp at time zone 'Asia/Shanghai';
     if v_stamp>now() or v_stamp<now()-interval '2 minutes' or v_stamp<s.enabled_at then continue;end if;
     insert into public.zxj_push_reminders_jobs(user_id,device_id,subscription,due_at,habit_id,event_key,title)
     values(s.user_id,s.device_id,s.subscription,v_stamp,t->>'id','habit|'||(t->>'id')||'|'||v_value,t->>'title')
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
