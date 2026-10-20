-- Run the full script in Supabase SQL Editor after schema.sql and policies.sql.
-- Adds in-site support conversations, inbox notifications, product announcements, and RLS.
-- This migration does not send external email; that requires a separately configured server-side provider.
begin;

alter table public.profiles
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

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null default 'Customer support',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists support_messages_conversation_created_idx
  on public.support_messages (conversation_id, created_at);

create table if not exists public.inbox_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('product', 'support')),
  title text not null,
  message text not null,
  href text not null,
  conversation_id uuid references public.support_conversations(id) on delete cascade,
  reference_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_sent_at timestamptz,
  unique (user_id, type, reference_id)
);

alter table public.inbox_notifications
  add column if not exists email_sent_at timestamptz;

create index if not exists inbox_notifications_user_created_idx
  on public.inbox_notifications (user_id, created_at desc);

revoke all on public.support_conversations from anon, authenticated;
grant select, insert on public.support_conversations to authenticated;
revoke all on public.support_messages from anon, authenticated;
grant select, insert on public.support_messages to authenticated;
revoke all on public.inbox_notifications from anon, authenticated;
grant select on public.inbox_notifications to authenticated;

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.inbox_notifications enable row level security;

drop policy if exists "customers and admins read support conversations"
  on public.support_conversations;
create policy "customers and admins read support conversations"
on public.support_conversations
for select
using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "customers create their own support conversation"
  on public.support_conversations;
create policy "customers create their own support conversation"
on public.support_conversations
for insert
with check (auth.uid() = user_id);

drop policy if exists "customers and admins read support messages"
  on public.support_messages;
create policy "customers and admins read support messages"
on public.support_messages
for select
using (
  public.is_admin(auth.uid())
  or exists (
    select 1
    from public.support_conversations
    where support_conversations.id = support_messages.conversation_id
      and support_conversations.user_id = auth.uid()
  )
);

drop policy if exists "customers and admins send support messages"
  on public.support_messages;
create policy "customers and admins send support messages"
on public.support_messages
for insert
with check (
  sender_id = auth.uid()
  and (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.support_conversations
      where support_conversations.id = support_messages.conversation_id
        and support_conversations.user_id = auth.uid()
    )
  )
);

drop policy if exists "message recipients mark messages read"
  on public.support_messages;
create policy "message recipients mark messages read"
on public.support_messages
for update
using (
  sender_id <> auth.uid()
  and (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.support_conversations
      where support_conversations.id = support_messages.conversation_id
        and support_conversations.user_id = auth.uid()
    )
  )
)
with check (
  sender_id <> auth.uid()
  and (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.support_conversations
      where support_conversations.id = support_messages.conversation_id
        and support_conversations.user_id = auth.uid()
    )
  )
);

revoke update on public.support_messages from authenticated;
grant update (read_at) on public.support_messages to authenticated;

drop policy if exists "users read their own inbox notifications"
  on public.inbox_notifications;
create policy "users read their own inbox notifications"
on public.inbox_notifications
for select
using (auth.uid() = user_id);

drop policy if exists "users mark their own inbox notifications read"
  on public.inbox_notifications;
create policy "users mark their own inbox notifications read"
on public.inbox_notifications
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke update on public.inbox_notifications from authenticated;
grant update (read_at) on public.inbox_notifications to authenticated;

create or replace function public.notify_support_message_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation_user_id uuid;
  sender_is_admin boolean;
begin
  select user_id into conversation_user_id
  from public.support_conversations
  where id = new.conversation_id;

  if conversation_user_id is null then
    raise exception 'Support conversation does not exist.';
  end if;

  sender_is_admin := public.is_admin(new.sender_id);

  update public.support_conversations
  set updated_at = now()
  where id = new.conversation_id;

  if sender_is_admin then
    insert into public.inbox_notifications (
      user_id, type, title, message, href, conversation_id, reference_id
    )
    values (
      conversation_user_id,
      'support',
      'Lumina support replied',
      left(new.body, 240),
      '/account#inbox',
      new.conversation_id,
      new.id
    );
  else
    insert into public.inbox_notifications (
      user_id, type, title, message, href, conversation_id, reference_id
    )
    select user_id, 'support', 'New customer support message', left(new.body, 240),
      '/admin/inbox', new.conversation_id, new.id
    from public.admin_roles
    on conflict (user_id, type, reference_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_support_message_participants_trigger
  on public.support_messages;
create trigger notify_support_message_participants_trigger
after insert on public.support_messages
for each row execute function public.notify_support_message_participants();

create or replace function public.mark_support_notification_read()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.read_at is null and new.read_at is not null then
    update public.inbox_notifications
    set read_at = new.read_at
    where reference_id = new.id
      and user_id = auth.uid()
      and read_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists mark_support_notification_read_trigger
  on public.support_messages;
create trigger mark_support_notification_read_trigger
after update of read_at on public.support_messages
for each row execute function public.mark_support_notification_read();

create or replace function public.announce_new_active_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active'
    and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    insert into public.inbox_notifications (user_id, type, title, message, href, reference_id)
    select profiles.id, 'product', 'New in the collection', new.name, '/product/' || new.slug, new.id
    from public.profiles
    where profiles.role = 'customer'
    on conflict (user_id, type, reference_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists announce_new_active_product_trigger
  on public.products;
create trigger announce_new_active_product_trigger
after insert or update of status on public.products
for each row execute function public.announce_new_active_product();

commit;

notify pgrst, 'reload schema';

select
  to_regclass('public.support_conversations') as support_conversations,
  to_regclass('public.support_messages') as support_messages,
  to_regclass('public.inbox_notifications') as inbox_notifications;
