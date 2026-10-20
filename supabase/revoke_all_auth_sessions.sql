-- Revoke every current Supabase Auth session without deleting user accounts or data.
-- Run this one-time script manually in the Supabase SQL Editor.
-- Already-issued access tokens remain valid until they expire.
with revoked_sessions as (
  delete from auth.sessions
  returning id
)
select count(*) as revoked_session_count
from revoked_sessions;
