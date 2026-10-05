-- Reversible read-only cutover. No rows are deleted or rewritten.
lock table public.gtd_projects,public.daily_routines,public.routine_logs,public.profiles in access exclusive mode;
create function public.executive_os_legacy_read_only() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Legacy tracker is read-only. Use Executive OS for all changes.' using errcode='42501';
end;
$$;
revoke execute on function public.executive_os_legacy_read_only() from public,anon,authenticated,service_role;
create trigger executive_os_read_only before insert or update or delete or truncate on public.gtd_projects for each statement execute function public.executive_os_legacy_read_only();
create trigger executive_os_read_only before insert or update or delete or truncate on public.daily_routines for each statement execute function public.executive_os_legacy_read_only();
create trigger executive_os_read_only before insert or update or delete or truncate on public.routine_logs for each statement execute function public.executive_os_legacy_read_only();
create trigger executive_os_read_only before insert or update or delete or truncate on public.profiles for each statement execute function public.executive_os_legacy_read_only();
revoke insert,update,delete,truncate,references,trigger on public.gtd_projects,public.daily_routines,public.routine_logs,public.profiles from public,anon,authenticated,service_role;
revoke execute on function public.gtd_promote_due_cards() from public,anon,authenticated,service_role;
select cron.alter_job(jobid,active:=false) from cron.job where jobname='gtd-promote-due-cards';
