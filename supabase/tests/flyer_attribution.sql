-- Run in SQL Editor or execute_sql. All fixtures roll back; sends no emails.
begin;
set local role service_role;
do $$
declare
  v uuid := gen_random_uuid(); v2 uuid := gen_random_uuid();
  vt uuid := gen_random_uuid(); ve uuid := gen_random_uuid();
  payload jsonb; saved jsonb; again jsonb; result jsonb;
  before_visits bigint; before_leads bigint; n bigint;
begin
  select visits, new_leads into before_visits,before_leads from public.tutor_flyer_report(null) where flyer_id='f1';
  result := public.register_tutor_flyer_visit(v,'f1','/',repeat('a',32),false);
  assert (result->>'ok')::boolean, 'visit accepted';
  result := public.register_tutor_flyer_visit(v,'f1','/',repeat('a',32),false);
  assert (result->>'existing')::boolean, 'visit idempotent';
  result := public.register_tutor_flyer_visit(v,'f2','/',repeat('a',32),false);
  assert not (result->>'ok')::boolean, 'campaign cannot be overwritten';
  result := public.register_tutor_flyer_visit(gen_random_uuid(),'unknown','/',repeat('a',32),false);
  assert not (result->>'ok')::boolean, 'unknown campaign rejected';
  perform public.register_tutor_flyer_visit(vt,'f1','/',repeat('a',32),true);
  select visits into n from public.tutor_flyer_report(null) where flyer_id='f1';
  assert n=before_visits+1, 'test visits excluded and refresh deduplicated';

  payload := jsonb_build_object('source','forside','name','Flyer transaction test',
    'email',v::text||'@example.invalid','flyer_id','f1','flyer_visit_id',v);
  saved := public.submit_tutor_lead_with_attribution(payload);
  assert not (saved->>'duplicate')::boolean, 'new lead';
  select new_leads into n from public.tutor_flyer_report(null) where flyer_id='f1';
  assert n=before_leads+1, 'saved lead attributed';
  perform public.register_tutor_flyer_visit(v2,'f2','/',repeat('a',32),false);
  again := public.submit_tutor_lead_with_attribution(payload || jsonb_build_object('flyer_id','f2','flyer_visit_id',v2));
  assert (again->>'duplicate')::boolean, 'duplicate identified';
  assert exists(select 1 from public.tutor_flyer_conversions where lead_id=(saved->>'id')::uuid and visit_id=v), 'first conversion preserved';
  update public.tutor_leads set status='tilmeldt' where id=(saved->>'id')::uuid;
  assert exists(select 1 from public.tutor_flyer_report(null) where flyer_id='f1' and enrolled_leads>0), 'enrollment follows lead status';

  perform public.submit_tutor_lead_with_attribution(payload || jsonb_build_object('source','hold','email',vt::text||'@example.invalid','flyer_visit_id',vt));
  assert not exists(select 1 from public.tutor_flyer_conversions where visit_id=vt), 'test visit cannot attribute production lead';
  perform public.register_tutor_flyer_visit(ve,'f1','/',repeat('a',32),false);
  update public.tutor_flyer_visits set created_at=now()-interval '25 hours' where id=ve;
  result := public.register_tutor_flyer_visit(ve,'f1','/',repeat('a',32),false);
  assert not (result->>'ok')::boolean, 'expired visit must rotate';
  perform public.submit_tutor_lead_with_attribution(payload || jsonb_build_object('email',ve::text||'@example.invalid','flyer_visit_id',ve));
  assert not exists(select 1 from public.tutor_flyer_conversions where visit_id=ve), 'expired attribution rejected';
  saved := public.submit_tutor_lead_with_attribution(payload || jsonb_build_object('email',gen_random_uuid()::text||'@example.invalid','flyer_visit_id','bad'));
  assert (saved->>'id') is not null, 'bad tracking never blocks a lead';
  assert not exists(select 1 from public.tutor_flyer_conversions where lead_id=(saved->>'id')::uuid), 'bad tracking unattributed';

  insert into public.tutor_flyer_visits(id,flyer_id,landing_path,ip_day_hash)
    select gen_random_uuid(),'f3','/',repeat('b',32) from generate_series(1,120);
  result := public.register_tutor_flyer_visit(gen_random_uuid(),'f3','/',repeat('b',32),false);
  assert result->>'reason'='rate_limit', 'atomic visit rate limit';
end $$;
reset role;
do $$ begin
  assert not has_table_privilege('anon','public.tutor_flyer_visits','SELECT'), 'anon cannot read visits';
  assert not has_table_privilege('authenticated','public.tutor_flyer_visits','INSERT'), 'client cannot write visits';
  assert not has_function_privilege('anon','public.register_tutor_flyer_visit(uuid,text,text,text,boolean)','EXECUTE'), 'anon cannot bypass edge';
  assert not has_function_privilege('authenticated','public.submit_tutor_lead_with_attribution(jsonb)','EXECUTE'), 'users cannot bypass contact validation';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"email":"not-an-admin@example.invalid","role":"authenticated"}',true);
do $$ begin
  assert (select count(*)=0 from public.tutor_flyer_report(null)), 'non-admin cannot read report';
  assert (select count(*)=0 from public.tutor_flyer_visits), 'non-admin cannot read rows';
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('email',(select email from public.admin_emails limit 1),'role','authenticated')::text,true) is not null as admin_test_claims_set;
set local role authenticated;
do $$ begin
  assert (select count(*)=5 from public.tutor_flyer_report(null)), 'admin can read all five campaigns';
  assert (select count(*)>0 from public.tutor_lead_flyers), 'admin can read attribution';
end $$;
rollback;
select 'PASS: attribution, deduplication, expiry, test exclusion, rate limit, enrollment, admin and public permissions' as result;
