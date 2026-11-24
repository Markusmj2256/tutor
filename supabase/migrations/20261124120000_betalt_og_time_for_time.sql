-- Betalt-status på timepakker og "time for time" som betalingsform.
--
-- * forloeb_packages.paid_on: hvornår familien har betalt pakken. Tom = ikke
--   betalt endnu. Virker uanset om fakturaen er lavet i systemet eller i hånden.
-- * forloeb.billing: 'pakke' (købte timer, der trækkes fra) eller 'enkelt'
--   (time for time, ingen pakke). Eksisterende forløb er pakker.
--
-- Rettighederne følger tabellerne: admin må skrive, forældre må læse.

alter table public.forloeb_packages
  add column paid_on date;
comment on column public.forloeb_packages.paid_on is
  'Dato for familiens betaling af pakken. NULL = ikke betalt.';

alter table public.forloeb
  add column billing text not null default 'pakke'
  check (billing in ('pakke', 'enkelt'));
comment on column public.forloeb.billing is
  'pakke = timepakke, hvor timerne trækkes fra. enkelt = time for time uden pakke.';
