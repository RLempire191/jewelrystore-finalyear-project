-- Run this migration in the Supabase SQL Editor to enable editable customer profiles
-- and multiple saved delivery addresses.
begin;

alter table public.profiles
  add column if not exists phone text not null default '',
  add column if not exists state text not null default '',
  add column if not exists marketing_email_opt_in boolean not null default false,
  add column if not exists marketing_email_opt_in_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, full_name, email, city, state, marketing_email_opt_in
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'city', 'Lagos'),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'marketing_email_opt_in' = 'true', false)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_profile_email_from_auth_user_trigger on auth.users;
create trigger sync_profile_email_from_auth_user_trigger
  after update of email on auth.users
  for each row execute function public.sync_profile_email_from_auth_user();

create or replace function public.sync_marketing_email_opt_in_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.marketing_email_opt_in then
    if tg_op = 'INSERT' or old.marketing_email_opt_in is distinct from true then
      new.marketing_email_opt_in_at := now();
    else
      new.marketing_email_opt_in_at := old.marketing_email_opt_in_at;
    end if;
  else
    new.marketing_email_opt_in_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_marketing_email_opt_in_timestamp_trigger on public.profiles;
create trigger sync_marketing_email_opt_in_timestamp_trigger
  before insert or update of marketing_email_opt_in on public.profiles
  for each row execute function public.sync_marketing_email_opt_in_timestamp();

create table if not exists public.user_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  phone text not null,
  street text not null,
  city text not null,
  state text not null,
  country text not null default 'Nigeria',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_addresses_user_id_idx
  on public.user_addresses (user_id);

create unique index if not exists user_addresses_one_default_idx
  on public.user_addresses (user_id)
  where is_default;

alter table public.user_addresses enable row level security;

drop policy if exists "users manage their own addresses" on public.user_addresses;
create policy "users manage their own addresses"
on public.user_addresses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.keep_single_default_user_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.user_addresses
    set is_default = false
    where user_id = new.user_id
      and id <> new.id
      and is_default;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_single_default_user_address_trigger on public.user_addresses;
create trigger keep_single_default_user_address_trigger
before insert or update of is_default on public.user_addresses
for each row execute function public.keep_single_default_user_address();

create or replace function public.touch_user_addresses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_user_addresses_updated_at_trigger on public.user_addresses;
create trigger touch_user_addresses_updated_at_trigger
before update on public.user_addresses
for each row execute function public.touch_user_addresses_updated_at();

create or replace function public.protect_profile_role_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role
    and not public.is_admin(auth.uid())
    and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Only an administrator can change a profile role.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role_changes_trigger on public.profiles;
create trigger protect_profile_role_changes_trigger
before update of role on public.profiles
for each row execute function public.protect_profile_role_changes();

create or replace function public.sync_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_auth_email_to_profile_trigger on auth.users;
create trigger sync_auth_email_to_profile_trigger
after update of email on auth.users
for each row execute function public.sync_auth_email_to_profile();

commit;
