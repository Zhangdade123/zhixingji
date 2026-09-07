-- 在部署脚本执行成功、网页设置已同步后运行。只读，不发送邮件。
select jobname, schedule, active from cron.job where jobname='zxj_mail_v2';

select d.status, d.return_message,
       d.start_time at time zone 'Asia/Shanghai' as started_beijing
from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname='zxj_mail_v2' order by d.start_time desc limit 10;

-- 不输出发送密钥、地址或正文，只检查配置是否完整。
select user_id, data#>>'{settings,mailMode}' as mail_mode,
       data#>>'{settings,mailOn}' as mail_enabled,
       coalesce(data#>>'{settings,mail,serviceId}','')<>'' as has_service,
       coalesce(data#>>'{settings,mail,templateId}','')<>'' as has_template,
       coalesce(data#>>'{settings,mail,publicKey}','')<>'' as has_public_key,
       coalesce(data#>>'{settings,mail,to}','')<>'' as has_explicit_recipient,
       updated_at at time zone 'Asia/Shanghai' as synced_beijing
from public.zxj_sync where id='main';

select todo_id, kind, state,
       due_at at time zone 'Asia/Shanghai' as due_beijing,
       requested_at at time zone 'Asia/Shanghai' as requested_beijing,
       extract(epoch from requested_at-due_at)::integer as request_delay_seconds,
       updated_at at time zone 'Asia/Shanghai' as updated_beijing,
       error
from zxj_private.mail_outbox order by updated_at desc limit 10;
