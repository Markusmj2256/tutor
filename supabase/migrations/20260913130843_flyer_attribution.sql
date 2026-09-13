-- Extends the existing tutor_leads / is_admin / submit_tutor_lead backend.
create table public.tutor_flyers (
  id text primary key check (id ~ '^f[1-5]$'),
  name text not null,
  landing_path text not null,
  active boolean not null default true
);
insert into public.tutor_flyers (id, name, landing_path) values
  ('f1', '01 · Mere ro', '/'),
  ('f2', '02 · Styr på matematikken', '/'),
  ('f3', '03 · Tryghed til at spørge', '/'),
  ('f4', '04 · 1:1-undervisning', '/eneundervisning.html'),
  ('f5', '05 · Holdundervisning', '/holdundervisning.html');

create table public.tutor_flyer_visits (
  id uuid primary key,
  flyer_id text not null references public.tutor_flyers(id),
  created_at timestamptz not null default now(),
  landing_path text not null,
  is_test boolean not null default false,
  ip_day_hash text
);
create index tutor_flyer_visits_campaign_date on public.tutor_flyer_visits(flyer_id, created_at);
create index tutor_flyer_visits_rate on public.tutor_flyer_visits(ip_day_hash, created_at) where ip_day_hash is not null;

create table public.tutor_flyer_conversions (
  lead_id uuid primary key references public.tutor_leads(id) on delete cascade,
  visit_id uuid not null references public.tutor_flyer_visits(id),
  created_at timestamptz not null default now()
);
create index tutor_flyer_conversions_visit on public.tutor_flyer_conversions(visit_id);

alter table public.tutor_flyers enable row level security;
alter table public.tutor_flyer_visits enable row level security;
alter table public.tutor_flyer_conversions enable row level security;
revoke all on public.tutor_flyers, public.tutor_flyer_visits, public.tutor_flyer_conversions from public, anon, authenticated;
grant select on public.tutor_flyers, public.tutor_flyer_visits, public.tutor_flyer_conversions to authenticated;
grant all on public.tutor_flyers, public.tutor_flyer_visits, public.tutor_flyer_conversions to service_role;
create policy "Admin reads flyers" on public.tutor_flyers for select to authenticated using ((select public.is_admin()));
create policy "Admin reads flyer visits" on public.tutor_flyer_visits for select to authenticated using ((select public.is_admin()));
create policy "Admin reads flyer conversions" on public.tutor_flyer_conversions for select to authenticated using ((select public.is_admin()));

-- The Edge Function calls this with a daily salted hash. Locking makes the
-- rate limit atomic. Repeated requests with the same visit ID are idempotent.
create function public.register_tutor_flyer_visit(
  p_id uuid, p_flyer text, p_path text, p_ip_hash text, p_test boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.tutor_flyer_visits%rowtype;
begin
  if not exists(select 1 from public.tutor_flyers where id=p_flyer and active)
     or p_path not in ('/', '/index.html', '/eneundervisning.html', '/holdundervisning.html')
     or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 17));
  select * into v from public.tutor_flyer_visits where id=p_id;
  if found then
    return jsonb_build_object('ok', v.flyer_id=p_flyer and v.is_test=p_test
      and v.created_at > now()-interval '24 hours', 'existing', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 23));
  if (select count(*) from public.tutor_flyer_visits
      where ip_day_hash=p_ip_hash and created_at > now()-interval '1 hour') >= 120 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limit');
  end if;
  insert into public.tutor_flyer_visits(id, flyer_id, landing_path, ip_day_hash, is_test)
    values(p_id, p_flyer, p_path, p_ip_hash, p_test);
  return jsonb_build_object('ok', true, 'existing', false);
end;
$$;
revoke all on function public.register_tutor_flyer_visit(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.register_tutor_flyer_visit(uuid,text,text,text,boolean) to service_role;

-- Both saving the lead and attribution happen in one transaction. A duplicate
-- submission never changes the original attribution or adds a conversion.
create function public.submit_tutor_lead_with_attribution(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved jsonb; v_id uuid;
begin
  saved := public.submit_tutor_lead(payload);
  if not (saved->>'duplicate')::boolean
     and coalesce(payload->>'flyer_visit_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_id := (payload->>'flyer_visit_id')::uuid;
    insert into public.tutor_flyer_conversions(lead_id, visit_id)
      select (saved->>'id')::uuid, id from public.tutor_flyer_visits
      where id=v_id and flyer_id=payload->>'flyer_id' and not is_test
        and created_at > now()-interval '24 hours'
      on conflict(lead_id) do nothing;
  end if;
  return saved;
end;
$$;
revoke all on function public.submit_tutor_lead_with_attribution(jsonb) from public, anon, authenticated;
grant execute on function public.submit_tutor_lead_with_attribution(jsonb) to service_role;

-- Date filters select visits in the period; later lead/status changes remain
-- attributed to those visits, so the numerator and denominator share a cohort.
create function public.tutor_flyer_report(p_days integer default 30)
returns table(flyer_id text, name text, landing_path text, visits bigint,
  new_leads bigint, converted_visits bigint, contact_rate numeric,
  enrolled_leads bigint, enrolled_visits bigint, enrollment_rate numeric)
language sql stable security invoker set search_path = '' as $$
  with totals as (
    select f.id, f.name, f.landing_path,
      count(distinct v.id) as visits,
      count(c.lead_id) as new_leads,
      count(distinct v.id) filter(where c.lead_id is not null) as converted_visits,
      count(c.lead_id) filter(where l.status='tilmeldt') as enrolled_leads,
      count(distinct v.id) filter(where l.status='tilmeldt') as enrolled_visits
    from public.tutor_flyers f
    left join public.tutor_flyer_visits v on v.flyer_id=f.id and not v.is_test
      and (p_days is null or v.created_at >= now()-make_interval(days => greatest(1,least(p_days,3650))))
    left join public.tutor_flyer_conversions c on c.visit_id=v.id
    left join public.tutor_leads l on l.id=c.lead_id
    group by f.id, f.name, f.landing_path
  )
  select id, name, landing_path, visits, new_leads, converted_visits,
    round(100.0*converted_visits/nullif(visits,0),1), enrolled_leads, enrolled_visits,
    round(100.0*enrolled_visits/nullif(visits,0),1)
  from totals order by id;
$$;
revoke all on function public.tutor_flyer_report(integer) from public, anon;
grant execute on function public.tutor_flyer_report(integer) to authenticated, service_role;

create view public.tutor_flyer_performance with (security_invoker=true) as
  select * from public.tutor_flyer_report(null);
create view public.tutor_lead_flyers with (security_invoker=true) as
  select c.lead_id, f.id as flyer_id, f.name as flyer_name
  from public.tutor_flyer_conversions c
  join public.tutor_flyer_visits v on v.id=c.visit_id
  join public.tutor_flyers f on f.id=v.flyer_id;
revoke all on public.tutor_flyer_performance, public.tutor_lead_flyers from public, anon, authenticated;
grant select on public.tutor_flyer_performance, public.tutor_lead_flyers to authenticated, service_role;
comment on view public.tutor_flyer_performance is 'All-time flyer funnel, excluding tests. Rates use distinct converted visits / visits. Accessible only to admins.';
comment on table public.tutor_flyer_visits is 'One ID per tracked URL journey, valid for attribution for 24 hours. No cookies, raw IP or user agent. is_test rows excluded from reports.';
