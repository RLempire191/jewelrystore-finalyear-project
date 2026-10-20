-- Run in the Supabase SQL Editor after the account has been created in Supabase Auth.
-- Assigns administration@gmail.com an administrator role for the Lumina admin dashboard.
begin;

do $$
declare
  target_email constant text := 'administration@gmail.com';
  target_user_id uuid;
begin
  select id
  into target_user_id
  from auth.users
  where lower(email) = lower(target_email);

  if target_user_id is null then
    raise exception 'No Supabase Auth account exists for %; create the account first.', target_email;
  end if;

  insert into public.profiles (id, full_name, email, role, city)
  select
    id,
    coalesce(raw_user_meta_data->>'full_name', ''),
    email,
    'admin',
    coalesce(raw_user_meta_data->>'city', 'Lagos')
  from auth.users
  where id = target_user_id
  on conflict (id) do update
    set role = 'admin';

  insert into public.admin_roles (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;
end;
$$;

select
  profiles.email,
  profiles.role,
  admin_roles.user_id is not null as admin_role_assigned
from public.profiles
left join public.admin_roles on admin_roles.user_id = profiles.id
where lower(profiles.email) = lower('administration@gmail.com');

commit;
