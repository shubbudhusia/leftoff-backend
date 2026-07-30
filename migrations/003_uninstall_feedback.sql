-- LeftOff — uninstall feedback
-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
--
-- Chrome opens this page automatically right after someone uninstalls the
-- extension (via chrome.runtime.setUninstallURL). The extension itself is
-- already gone by then, so this is a plain webpage, not part of the
-- extension — one click on a reason button submits directly, no login,
-- no personal data collected.

create table if not exists public.uninstall_feedback (
  id                uuid primary key default gen_random_uuid(),
  reason            text not null,
  details           text,
  extension_version text,
  created_at        timestamptz not null default now()
);

create index if not exists uninstall_feedback_created_at_idx on public.uninstall_feedback (created_at desc);
create index if not exists uninstall_feedback_reason_idx on public.uninstall_feedback (reason);

-- The backend connects with the service_role key, which bypasses RLS.
-- Enabling RLS with no policies means the anon key (if ever exposed)
-- can't read these submissions.
alter table public.uninstall_feedback enable row level security;
