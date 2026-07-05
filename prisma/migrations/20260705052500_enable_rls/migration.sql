-- Enable Row Level Security on public tables exposed to PostgREST.
-- Prisma connects as the postgres role and bypasses RLS.
-- No permissive policies for anon/authenticated => Data API access denied.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.generations FROM anon, authenticated;
