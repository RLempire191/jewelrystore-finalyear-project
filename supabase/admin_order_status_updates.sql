-- Run once in the Supabase SQL Editor to allow admins to update an order's
-- fulfillment status. Customer access remains read-only and restricted by RLS.
begin;

drop policy if exists "admins update order status" on public.orders;
create policy "admins update order status"
on public.orders
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

revoke update on public.orders from authenticated;
grant update (status) on public.orders to authenticated;

notify pgrst, 'reload schema';
commit;
