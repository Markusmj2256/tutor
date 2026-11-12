-- Kundesiden: forældre følger deres barns forløb på /forloeb, og ejeren
-- vedligeholder det på /forloeb-admin.
--
-- Adgangen afgøres her i databasen, ikke i klienten:
--   * admin (mail i admin_emails) må alt.
--   * en forælder må læse de forløb, hvor deres bekræftede mail står i
--     forloeb_parents, og intet andet. Forældre kan ikke skrive.
--   * anon har ingen adgang.

create table public.forloeb (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  student    text not null check (char_length(student) between 1 and 80),
  grade      text not null default '' check (char_length(grade) <= 40),
  subject    text not null default '' check (char_length(subject) <= 80),
  goal       text not null default '' check (char_length(goal) <= 80),
  next_date  date,
  next_time  time
);
comment on table public.forloeb is
  'Et undervisningsforløb for én elev. Læses af elevens forældre via RLS, skrives kun af admin.';

create table public.forloeb_parents (
  id            uuid primary key default gen_random_uuid(),
  forloeb_id    uuid not null references public.forloeb (id) on delete cascade,
  created_at    timestamptz not null default now(),
  name          text not null check (char_length(name) between 1 and 80),
  email         text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  invited_at    timestamptz,
  last_login_at timestamptz,
  unique (forloeb_id, email)
);
create index forloeb_parents_email_idx on public.forloeb_parents (email);
comment on table public.forloeb_parents is
  'Forældre med adgang til et forløb. Mailadressen er nøglen: den, der kan logge ind med den, kan læse forløbet.';

create table public.forloeb_packages (
  id         uuid primary key default gen_random_uuid(),
  forloeb_id uuid not null references public.forloeb (id) on delete cascade,
  created_at timestamptz not null default now(),
  bought_on  date not null default current_date,
  hours      numeric(5,1) not null check (hours > 0 and hours <= 500)
);
create index forloeb_packages_forloeb_idx on public.forloeb_packages (forloeb_id);

create table public.forloeb_sessions (
  id         uuid primary key default gen_random_uuid(),
  forloeb_id uuid not null references public.forloeb (id) on delete cascade,
  created_at timestamptz not null default now(),
  held_on    date not null,
  hours      numeric(3,1) not null check (hours > 0 and hours <= 10),
  level      smallint check (level between 1 and 5),
  topic      text not null check (char_length(topic) between 1 and 80),
  worked     text not null default '' check (char_length(worked) <= 4000),
  good       text not null default '' check (char_length(good) <= 4000),
  next_step  text not null default '' check (char_length(next_step) <= 4000)
);
create index forloeb_sessions_forloeb_idx on public.forloeb_sessions (forloeb_id, held_on);
comment on table public.forloeb_sessions is
  'Én afholdt undervisningsgang med rapport. Timerne trækkes fra de købte pakker.';

-- Loginforsøg, så funktionen forloeb-login kan begrænse antallet af mails.
-- Kun saltede hashes, ingen mailadresser eller IP-adresser i klartekst.
create table public.forloeb_login_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash    text not null,
  email_hash text not null,
  sent       boolean not null default false
);
create index forloeb_login_log_created_idx on public.forloeb_login_log (created_at);
comment on table public.forloeb_login_log is
  'Rate limiting for login-links. RLS uden policies med vilje: kun edge-funktionen forloeb-login skriver her.';

-- Den indloggede brugers bekræftede mail. Læser auth.users frem for JWT'en,
-- så en ubekræftet konto aldrig giver adgang.
create function public.forloeb_my_email()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null;
$$;

create function public.is_forloeb_parent(p_forloeb uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.forloeb_parents p
    where p.forloeb_id = p_forloeb
      and p.email = (select public.forloeb_my_email())
  );
$$;

-- Forældresiden kalder denne ved besøg, så ejeren kan se, om linket er brugt.
create function public.forloeb_touch_login()
returns void
language sql
security definer
set search_path to ''
as $$
  update public.forloeb_parents
  set last_login_at = now()
  where email = (select public.forloeb_my_email());
$$;

revoke all on function public.forloeb_my_email() from public, anon;
revoke all on function public.is_forloeb_parent(uuid) from public, anon;
revoke all on function public.forloeb_touch_login() from public, anon;
grant execute on function public.forloeb_my_email() to authenticated, service_role;
grant execute on function public.is_forloeb_parent(uuid) to authenticated, service_role;
grant execute on function public.forloeb_touch_login() to authenticated, service_role;

alter table public.forloeb enable row level security;
alter table public.forloeb_parents enable row level security;
alter table public.forloeb_packages enable row level security;
alter table public.forloeb_sessions enable row level security;
alter table public.forloeb_login_log enable row level security;

-- Supabase' standardrettigheder giver anon og authenticated alt, også
-- TRUNCATE, som RLS ikke dækker. Vi giver kun det nødvendige tilbage.
revoke all on public.forloeb, public.forloeb_parents, public.forloeb_packages,
  public.forloeb_sessions, public.forloeb_login_log from anon, authenticated;
grant select, insert, update, delete on public.forloeb, public.forloeb_parents,
  public.forloeb_packages, public.forloeb_sessions to authenticated;

create policy forloeb_admin on public.forloeb for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy forloeb_parent_read on public.forloeb for select to authenticated
  using ((select public.is_forloeb_parent(id)));

create policy forloeb_parents_admin on public.forloeb_parents for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- En forælder ser kun sin egen række, ikke den anden forælders mail.
create policy forloeb_parents_self_read on public.forloeb_parents for select to authenticated
  using (email = (select public.forloeb_my_email()));

create policy forloeb_packages_admin on public.forloeb_packages for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy forloeb_packages_parent_read on public.forloeb_packages for select to authenticated
  using (public.is_forloeb_parent(forloeb_id));

create policy forloeb_sessions_admin on public.forloeb_sessions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy forloeb_sessions_parent_read on public.forloeb_sessions for select to authenticated
  using (public.is_forloeb_parent(forloeb_id));
