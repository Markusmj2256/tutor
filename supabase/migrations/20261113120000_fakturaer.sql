-- Fakturering fra /forloeb-admin.
--
--   * faktura_settings: ejerens egne oplysninger (adresse, konto, betalingsfrist).
--     Én række, som ejeren retter i backend.
--   * fakturaer: udstedte fakturaer og kreditnotaer. En række kan ikke rettes
--     eller slettes, når den er oprettet — en fejl rettes med en kreditnota.
--     Kun "betalt den" må ændres bagefter.
--
-- Rækkerne oprettes af edge-funktionen faktura (service_role), som også
-- danner PDF'en og sender mailen. Admin kan læse; forældre og anon kan intet.

create table public.faktura_settings (
  id           boolean primary key default true check (id),
  updated_at   timestamptz not null default now(),
  seller_name  text not null default 'Lokaltutor v/ Markus Johnsen' check (char_length(seller_name) between 1 and 120),
  cvr          text not null default '46785290' check (char_length(cvr) <= 20),
  address      text not null default '' check (char_length(address) <= 120),
  zip_city     text not null default '' check (char_length(zip_city) <= 80),
  email        text not null default '' check (char_length(email) <= 200),
  phone        text not null default '24 25 99 86' check (char_length(phone) <= 40),
  bank_reg     text not null default '' check (bank_reg ~ '^[0-9]{0,4}$'),
  bank_account text not null default '' check (bank_account ~ '^[0-9 ]{0,14}$'),
  mobilepay    text not null default '' check (char_length(mobilepay) <= 20),
  payment_days smallint not null default 8 check (payment_days between 0 and 90),
  vat_rate     numeric(4,2) not null default 0 check (vat_rate in (0, 25)),
  vat_note     text not null default '' check (char_length(vat_note) <= 200),
  first_number integer not null default 1 check (first_number between 1 and 9999999)
);
comment on table public.faktura_settings is
  'Sælgers oplysninger på fakturaen. Én række. Kopieres ind på hver faktura, når den udstedes.';
insert into public.faktura_settings default values;

create table public.fakturaer (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  number            integer not null unique,
  kind              text not null default 'faktura' check (kind in ('faktura', 'kreditnota')),
  credits           uuid references public.fakturaer (id),
  forloeb_id        uuid references public.forloeb (id) on delete set null,
  issued_on         date not null default current_date,
  due_on            date not null,
  student           text not null check (char_length(student) between 1 and 80),
  recipient_name    text not null check (char_length(recipient_name) between 1 and 80),
  recipient_email   text not null check (char_length(recipient_email) <= 200),
  recipient_address text not null default '' check (char_length(recipient_address) <= 200),
  package           text not null check (char_length(package) <= 20),
  hours             numeric(5,1) not null,
  lines             jsonb not null,
  total             numeric(10,2) not null,
  vat_rate          numeric(4,2) not null default 0,
  vat_amount        numeric(10,2) not null default 0,
  seller            jsonb not null,
  sent_at           timestamptz,
  paid_on           date,
  check ((kind = 'kreditnota') = (credits is not null))
);
create index fakturaer_forloeb_idx on public.fakturaer (forloeb_id);
-- En faktura kan kun krediteres én gang.
create unique index fakturaer_credits_idx on public.fakturaer (credits) where credits is not null;
comment on table public.fakturaer is
  'Udstedte fakturaer og kreditnotaer. Skal gemmes i 5 år (bogføringsloven) og overlever derfor, at forløbet slettes.';
comment on column public.fakturaer.seller is 'Sælgers oplysninger, som de var, da fakturaen blev udstedt.';

-- Fortløbende numre uden huller: nummeret sættes her, ikke af den, der indsætter.
create function public.faktura_assign_number()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform pg_advisory_xact_lock(46785290);
  select greatest(
    coalesce((select max(f.number) from public.fakturaer f), 0) + 1,
    coalesce((select s.first_number from public.faktura_settings s), 1)
  ) into new.number;
  return new;
end;
$$;
revoke all on function public.faktura_assign_number() from public, anon, authenticated;

create trigger fakturaer_number before insert on public.fakturaer
  for each row execute function public.faktura_assign_number();

alter table public.faktura_settings enable row level security;
alter table public.fakturaer enable row level security;

revoke all on public.faktura_settings, public.fakturaer from anon, authenticated;
grant select, update on public.faktura_settings to authenticated;
grant select on public.fakturaer to authenticated;
grant update (paid_on) on public.fakturaer to authenticated;

create policy faktura_settings_admin on public.faktura_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy fakturaer_admin_read on public.fakturaer for select to authenticated
  using ((select public.is_admin()));
create policy fakturaer_admin_paid on public.fakturaer for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
