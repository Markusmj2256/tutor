-- Flyers v2: fire nye designs med hver sin kode (f6–f9).
-- Koderne var låst til f1–f5; nu tillades f1–f99, så nye flyers kun kræver en række her.
alter table public.tutor_flyers drop constraint tutor_flyers_id_check;
alter table public.tutor_flyers add constraint tutor_flyers_id_check check (id ~ '^f[1-9][0-9]?$');

insert into public.tutor_flyers (id, name, landing_path) values
  ('f6', 'V2-01 · Overskud', '/'),
  ('f7', 'V2-02 · Det siger familierne', '/'),
  ('f8', 'V2-03 · Mere end den burde', '/'),
  ('f9', 'V2-04 · Tre trin', '/');
