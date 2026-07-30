-- LeftOff — remove dead/unused tables
-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
--
-- These 3 tables are not referenced anywhere in the current backend code
-- (confirmed by searching every .from('...') call across the codebase):
--   - activity_logs : empty, never written to by any live code path
--   - leftoff_videos: empty, never written to — actual video/queue data
--                     lives in user_sync.data (jsonb) instead
--   - users         : the OLD pre-migration table, replaced by
--                     extension_users. Still has 1 leftover test row.
--
-- No CASCADE is used on purpose: if something unexpected still depends on
-- one of these, the DROP will fail loudly with a clear error instead of
-- silently deleting other data.

drop table if exists public.activity_logs;
drop table if exists public.leftoff_videos;
drop table if exists public.users;
