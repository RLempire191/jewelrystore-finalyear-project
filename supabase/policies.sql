alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.wishlists enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_roles enable row level security;
alter table public.user_addresses enable row level security;

-- Drop existing policies first to allow clean re-runs
drop policy if exists "profiles can insert their own row" on public.profiles;
drop policy if exists "profiles can read their own row" on public.profiles;
drop policy if exists "profiles can update their own row" on public.profiles;
drop policy if exists "categories are public" on public.categories;
drop policy if exists "categories are admin managed" on public.categories;
drop policy if exists "products are public" on public.products;
drop policy if exists "products are admin managed" on public.products;
drop policy if exists "product images are public" on public.product_images;
drop policy if exists "product images are admin managed" on public.product_images;
drop policy if exists "wishlists belong to the user" on public.wishlists;
drop policy if exists "cart items belong to the user" on public.cart_items;
drop policy if exists "orders are visible to the customer or admin" on public.orders;
drop policy if exists "customers can create orders" on public.orders;
drop policy if exists "admins update order status" on public.orders;
drop policy if exists "order items are visible with their parent order" on public.order_items;
drop policy if exists "order items can be managed by admins" on public.order_items;
drop policy if exists "admin roles can bootstrap and manage" on public.admin_roles;
drop policy if exists "users manage their own addresses" on public.user_addresses;

create policy "profiles can insert their own row"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles can read their own row"
on public.profiles
for select
using (auth.uid() = id or public.is_admin(auth.uid()));

create policy "profiles can update their own row"
on public.profiles
for update
using (auth.uid() = id or public.is_admin(auth.uid()))
with check (auth.uid() = id or public.is_admin(auth.uid()));

create policy "categories are public"
on public.categories
for select
using (true);

create policy "categories are admin managed"
on public.categories
for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "products are public"
on public.products
for select
using (status = 'active' or public.is_admin(auth.uid()));

create policy "products are admin managed"
on public.products
for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "product images are public"
on public.product_images
for select
using (exists (
  select 1
  from public.products
  where id = product_images.product_id
    and (status = 'active' or public.is_admin(auth.uid()))
));

create policy "product images are admin managed"
on public.product_images
for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "wishlists belong to the user"
on public.wishlists
for all
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "cart items belong to the user"
on public.cart_items
for all
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "orders are visible to the customer or admin"
on public.orders
for select
using (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "customers can create orders"
on public.orders
for insert
with check (auth.uid() = user_id or auth.uid() is null);

create policy "admins update order status"
on public.orders
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke update on public.orders from authenticated;
grant update (status) on public.orders to authenticated;

create policy "order items are visible with their parent order"
on public.order_items
for select
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and (orders.user_id = auth.uid() or public.is_admin(auth.uid()))
  )
);

create policy "order items can be managed by admins"
on public.order_items
for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create policy "admin roles can bootstrap and manage"
on public.admin_roles
for all
using (public.is_admin(auth.uid()) or not public.has_admin_roles())
with check (public.is_admin(auth.uid()) or not public.has_admin_roles());

create policy "users manage their own addresses"
on public.user_addresses
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
