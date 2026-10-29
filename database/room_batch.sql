-- Additive wrapper around the existing code-based patch_room API.
-- Existing rooms remain public to readers. A room code is an edit capability, not authentication.
create or replace function public.patch_room_batch(p_code text, p_changes jsonb, p_operation text, p_expected_version integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s jsonb; v integer; c jsonb; path text[]; val jsonb; seen jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>20 or octet_length(p_changes::text)>60000 then raise exception 'bad changes'; end if;
  if p_operation is null or length(p_operation)>80 then raise exception 'bad operation'; end if;
  -- Existing RPC obtains the row lock; all following changes are in this transaction.
  s := public.patch_room(p_code,array['_batch_lock'],to_jsonb(p_operation));
  select version into v from public.rooms where code=p_code;
  seen := coalesce(s->'_operations','[]'::jsonb);
  if seen ? p_operation then
    return jsonb_build_object('state',s,'version',v);
  end if;
  if p_expected_version is not null and v <> p_expected_version+1 then raise exception 'conflict: room changed'; end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(c->'path') is distinct from 'array' then raise exception 'bad path'; end if;
    select array_agg(value order by ord) into path from jsonb_array_elements_text(c->'path') with ordinality as x(value,ord);
    if coalesce(array_length(path,1),0) not between 1 and 4 or not(path[1]=any(array['schema','id','stage','setup','live','clock','board','objectives','events','recommendation','finishedAt','reviewMatch','buildPlans','pivotIntents'])) or path && array['__proto__','constructor','prototype'] then raise exception 'bad path'; end if;
    if c ? 'increment' then
      if path[1]<>'live' or array_length(path,1)<>3 or path[3] not in ('deaths','wards') or abs((c->>'increment')::integer)<>1 then raise exception 'bad increment'; end if;
      val:=to_jsonb(greatest(0,coalesce((s#>>path)::integer,0)+(c->>'increment')::integer));
    else
      val:=coalesce(c->'value','null'::jsonb);
    end if;
    s:=public.patch_room(p_code,path,val);
  end loop;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into seen
    from (select value from jsonb_array_elements(seen || to_jsonb(p_operation)) with ordinality as x(value,ord)
      order by ord desc limit 100) x;
  s:=public.patch_room(p_code,array['_operations'],seen);
  select version into v from public.rooms where code=p_code;
  return jsonb_build_object('state',s,'version',v);
end;
$$;
revoke all on function public.patch_room_batch(text,jsonb,text,integer) from public;
grant execute on function public.patch_room_batch(text,jsonb,text,integer) to anon, authenticated;
