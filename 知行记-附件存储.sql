-- 在 Supabase 项目 SQL 编辑器执行一次；可重复执行。
-- 私有 bucket；对象路径第一段必须为登录用户 UID。
begin;
insert into storage.buckets(id,name,public,file_size_limit)
values ('zxj-files','zxj-files',false,20971520)
on conflict(id) do update set public=false,file_size_limit=20971520;
drop policy if exists zxj_files_select on storage.objects;
create policy zxj_files_select on storage.objects for select to authenticated
using (bucket_id='zxj-files' and (storage.foldername(name))[1]=(select auth.uid()::text));
drop policy if exists zxj_files_insert on storage.objects;
create policy zxj_files_insert on storage.objects for insert to authenticated
with check (bucket_id='zxj-files' and (storage.foldername(name))[1]=(select auth.uid()::text));
-- 不开放覆盖或删除，避免误伤其他事项、笔记和备份的文件引用。
commit;
