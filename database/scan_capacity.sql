-- Bound public ingestion to the current private collection's storage budget.
create or replace function public.check_scan_capacity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(271906301);
 if (select coalesce(sum(byte_size),0) from public.scan_captures)+new.byte_size>838860800
 or (select count(*) from public.scan_captures)>=10000 then
  raise exception 'photo_collection_capacity';
 end if;
 return new;
end;
$$;
revoke all on function public.check_scan_capacity() from public,anon,authenticated;
create trigger scan_collection_capacity before insert on public.scan_captures
for each row execute function public.check_scan_capacity();

