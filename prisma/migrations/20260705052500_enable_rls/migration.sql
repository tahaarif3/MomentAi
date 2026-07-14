-- Enable Row Level Security on public tables exposed to PostgREST.
-- Prisma connects as the postgres role and bypasses RLS.
-- No permissive policies for anon/authenticated => Data API access denied.
-- Roles anon/authenticated exist on Supabase only — skip REVOKE on plain Postgres (e.g. Travis CI).

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.users FROM anon, authenticated;
    REVOKE ALL ON TABLE public.generations FROM anon, authenticated;
  END IF;
END
$$;
