-- Adgangslisten afgør, hvem der er admin. Kun databasen selv (ejeren og
-- service_role) må røre den. RLS uden politikker afviser allerede
-- rækkeadgang, men TRUNCATE er ikke omfattet af RLS, og Supabase'
-- standardrettigheder gav anon og authenticated alt på tabellen.
-- is_admin() er SECURITY DEFINER og læser stadig listen som ejer.
revoke all on table public.admin_emails from anon, authenticated;
