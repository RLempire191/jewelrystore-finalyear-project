-- Allow customers to hide only their own cancelled orders from their account.
-- The order record remains available to administrators for store history.
begin;

alter table public.orders
  add column if not exists customer_hidden_at timestamptz;

create or replace function public.customer_hide_cancelled_order(target_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to update your order history.';
  end if;

  update public.orders
  set customer_hidden_at = now()
  where id = target_order_id
    and user_id = auth.uid()
    and status = 'cancelled'
    and customer_hidden_at is null;

  if not found then
    raise exception using errcode = '42501',
      message = 'Only your own cancelled orders can be removed from your order history.';
  end if;

  return true;
end;
$$;

revoke all on function public.customer_hide_cancelled_order(uuid) from public, anon;
grant execute on function public.customer_hide_cancelled_order(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
