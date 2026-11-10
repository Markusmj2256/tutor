-- Life Dashboard viser ubesvarede henvendelser som "Ring op"-blokke i kalenderen.
-- Dashboardets API kører med den offentlige nøgle, så adgangen til
-- personoplysningerne går gennem en funktion, der kræver en hemmelig nøgle.
-- Kun nøglens SHA-256-hash ligger i databasen.
create table public.dashboard_api_tokens (
  token_hash text primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.dashboard_api_tokens enable row level security;
revoke all on public.dashboard_api_tokens from anon, authenticated;

insert into public.dashboard_api_tokens (token_hash, note)
values ('64bf70a17890de10d9dd24e7ffd93d786a065e6950ff7c7541e074febd416679', 'Life Dashboard – ring op-blokke');

create function public.dashboard_callbacks(p_token text)
returns table (
  id uuid, created_at timestamptz, source text, name text, phone text,
  email text, level text, subject text, package text, message text
)
language sql
stable
security definer
set search_path to ''
as $$
  select l.id, l.created_at, l.source, l.name, l.phone, l.email,
         l.level, l.subject, l.package, left(l.message, 600)
  from public.tutor_leads l
  where l.status = 'ny'
    and exists (
      select 1 from public.dashboard_api_tokens t
      where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    )
  order by l.created_at desc
  limit 50;
$$;
revoke all on function public.dashboard_callbacks(text) from public, anon, authenticated;
grant execute on function public.dashboard_callbacks(text) to anon, service_role;
