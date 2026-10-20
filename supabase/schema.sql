create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  city text not null default 'Lagos',
  state text not null default '',
  marketing_email_opt_in boolean not null default false,
  marketing_email_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category_id uuid references public.categories(id) on delete set null,
  price numeric(12,2) not null,
  compare_at_price numeric(12,2),
  badge text,
  gemstone text not null default '',
  material text not null default '',
  description text not null default '',
  story text not null default '',
  rating numeric(3,2) not null default 4.8,
  featured boolean not null default false,
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  accent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  alt_text text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  shipping_city text not null default 'Lagos',
  shipping_state text not null default 'Lagos',
  shipping_country text not null default 'Nigeria',
  shipping_street text not null default '',
  payment_method text not null default 'Transfer',
  subtotal numeric(12,2) not null default 0,
  shipping_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'processing' check (status in ('processing', 'crafting', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists phone text not null default '';

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

create or replace function public.is_admin(user_uuid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  select exists (
    select 1
    from public.admin_roles
    where user_id = user_uuid
  ) into v_exists;

  return v_exists;
end;
$$;

create or replace function public.has_admin_roles()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return exists (select 1 from public.admin_roles);
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.make_order_number()
returns text
language sql
volatile
as $$
  select 'LM-' || to_char(clock_timestamp(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

drop function if exists public.create_order_with_items(jsonb);

create or replace function public.create_order_with_items(order_payload jsonb)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_order_number text := coalesce(order_payload->>'order_number', public.make_order_number());
  v_payment_method text := coalesce(order_payload->>'payment_method', 'Transfer');
  v_user_id uuid := auth.uid();
begin
  insert into public.orders (
    order_number,
    user_id,
    customer_name,
    customer_email,
    shipping_city,
    shipping_state,
    shipping_country,
    shipping_street,
    payment_method,
    subtotal,
    shipping_fee,
    total,
    note,
    payment_status
  )
  values (
    v_order_number,
    v_user_id,
    coalesce(order_payload->>'customer_name', ''),
    coalesce(order_payload->>'customer_email', ''),
    coalesce(order_payload->>'shipping_city', 'Lagos'),
    coalesce(order_payload->>'shipping_state', 'Lagos'),
    coalesce(order_payload->>'shipping_country', 'Nigeria'),
    coalesce(order_payload->>'shipping_street', ''),
    v_payment_method,
    coalesce((order_payload->>'subtotal')::numeric, 0),
    coalesce((order_payload->>'shipping_fee')::numeric, 0),
    coalesce((order_payload->>'total')::numeric, 0),
    coalesce(order_payload->>'note', ''),
    case when v_payment_method = 'Card' then 'paid' else 'pending' end
  )
  returning * into v_order;

  if jsonb_typeof(order_payload->'items') = 'array' then
    insert into public.order_items (order_id, product_id, quantity, price)
    select
      v_order.id,
      (item->>'productId')::uuid,
      coalesce((item->>'quantity')::integer, 1),
      coalesce((item->>'price')::numeric, 0)
    from jsonb_array_elements(order_payload->'items') as item;
  end if;

  return v_order;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_products_updated_at on public.products;
create trigger touch_products_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists touch_cart_items_updated_at on public.cart_items;
create trigger touch_cart_items_updated_at
before update on public.cart_items
for each row execute function public.touch_updated_at();

drop trigger if exists touch_orders_updated_at on public.orders;
create trigger touch_orders_updated_at
before update on public.orders
for each row execute function public.touch_updated_at();

drop trigger if exists touch_user_addresses_updated_at on public.user_addresses;
create trigger touch_user_addresses_updated_at
before update on public.user_addresses
for each row execute function public.touch_updated_at();

insert into public.categories (name, slug)
values
  ('Rings', 'rings'),
  ('Necklaces', 'necklaces'),
  ('Bracelets', 'bracelets'),
  ('Earrings', 'earrings'),
  ('Watches', 'watches')
on conflict do nothing;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('profile-assets', 'profile-assets', false)
on conflict do nothing;

-- Sync admin_roles whenever profiles.role is inserted or updated
create or replace function public.sync_admin_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' then
    insert into public.admin_roles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  else
    delete from public.admin_roles
    where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_admin_roles_trigger on public.profiles;
create trigger sync_admin_roles_trigger
after insert or update of role on public.profiles
for each row execute function public.sync_admin_roles();

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

-- Retroactively seed existing admins into admin_roles
insert into public.admin_roles (user_id)
select id from public.profiles
where role = 'admin'
on conflict (user_id) do nothing;
