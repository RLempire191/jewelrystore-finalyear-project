-- Run in Supabase SQL Editor to enable admin status changes and product deletion,
-- and to add 17 Nigeria-inspired starter products with jewelry photography.
begin;

drop function if exists public.admin_update_order_status(uuid, text);

create function public.admin_update_order_status(
  target_order_id uuid,
  new_status text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_order public.orders%rowtype;
  normalized_status text := lower(trim(new_status));
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'Administrator access is required to update orders.';
  end if;

  if normalized_status not in ('processing', 'crafting', 'shipped', 'delivered', 'cancelled') then
    raise exception using errcode = '22023', message = 'Invalid order status.';
  end if;

  update public.orders
  set status = normalized_status
  where id = target_order_id
  returning * into updated_order;

  if not found then
    raise exception using errcode = 'P0002', message = 'The order no longer exists.';
  end if;

  return updated_order;
end;
$$;

revoke all on function public.admin_update_order_status(uuid, text) from public, anon;
grant execute on function public.admin_update_order_status(uuid, text) to authenticated;

alter table public.order_items alter column product_id drop not null;
alter table public.order_items drop constraint if exists order_items_product_id_fkey;
alter table public.order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;

create or replace function public.admin_delete_product(target_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'Administrator access is required to delete products.';
  end if;

  delete from public.products
  where id = target_product_id;

  return found;
end;
$$;

revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;

insert into public.categories (name, slug)
values
  ('Rings', 'rings'),
  ('Necklaces', 'necklaces'),
  ('Bracelets', 'bracelets'),
  ('Earrings', 'earrings')
on conflict do nothing;

with product_seed (
  name, slug, category, price, badge, gemstone, material, description, story, image_url, accent
) as (
  values
    (
      'Aso-Oke Sunburst Hoops', 'aso-oke-sunburst-hoops', 'Earrings', 89500,
      'Lagos Edit', 'Polished gold finish', '18k gold vermeil',
      'Sculptural hoops with a warm, woven-ribbon silhouette inspired by aso-oke occasion dressing.',
      'Designed in Lagos as a confident everyday piece that carries the colour and rhythm of celebration.',
      'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #9a5b22 0%, #f0bd65 55%, #471d19 100%)'
    ),
    (
      'Adire Indigo Bead Necklace', 'adire-indigo-bead-necklace', 'Necklaces', 124000,
      'Hand-finished', 'Deep-blue glass beads', 'Indigo glass and gold-tone brass',
      'A layered strand of indigo beads with a polished gold-tone centre detail.',
      'A contemporary tribute to Yoruba adire dye traditions, made to bring a vivid Nigerian accent to simple linen and evening looks.',
      'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #101a3b 0%, #28477b 55%, #c49a46 100%)'
    ),
    (
      'Coral Heritage Cuff', 'coral-heritage-cuff', 'Bracelets', 148000,
      'Heritage piece', 'Coral-tone glass beads', 'Gold-tone brass and glass',
      'A bold open cuff framed with vivid coral-tone beads and a polished gold centre.',
      'Inspired by the ceremonial beadwork of southern Nigeria, reinterpreted as a modern statement for special gatherings.',
      'https://images.unsplash.com/photo-1603561596112-0a132b757442?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #70251f 0%, #d96b4c 50%, #e2b34f 100%)'
    ),
    (
      'Lagos Skyline Signet', 'lagos-skyline-signet', 'Rings', 112000,
      'New', 'Engraved skyline detail', '18k gold vermeil',
      'A smooth signet ring with a graphic skyline engraving and a softly brushed finish.',
      'The city’s lively horizon and layered energy inspired a personal signature ring with unmistakable Lagos character.',
      'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #132936 0%, #42616a 52%, #d3a44b 100%)'
    ),
    (
      'Zaria Filigree Pendant', 'zaria-filigree-pendant', 'Necklaces', 136000,
      'Atelier made', 'Openwork filigree', 'Gold-tone brass',
      'An airy geometric pendant with a finely detailed, hand-drawn filigree look.',
      'Its repeating geometry nods to the intricate craft and architecture found across northern Nigeria.',
      'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #543b20 0%, #d3a84f 53%, #f5e6b9 100%)'
    ),
    (
      'Calabar Tide Pearl Drops', 'calabar-tide-pearl-drops', 'Earrings', 104000,
      'Freshwater pearl', 'Freshwater-style pearls', 'Gold-tone brass and glass',
      'Fluid drop earrings pairing luminous pearl forms with a warm sculptural gold setting.',
      'Inspired by the coast and festive colour of Calabar, these light-catching drops are made for movement.',
      'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #174856 0%, #55a1a1 50%, #d3b36a 100%)'
    ),
    (
      'Ijebu Gold Bead Bracelet', 'ijebu-gold-bead-bracelet', 'Bracelets', 99000,
      'Everyday heirloom', 'Polished gold-tone beads', 'Gold-tone brass',
      'A flexible bracelet built from varied gold-tone beads with a small indigo accent.',
      'A modern keepsake inspired by the rich bead traditions of the southwest, designed to stack or wear alone.',
      'https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #51401d 0%, #d7b459 55%, #283d69 100%)'
    ),
    (
      'Ife Coral Signet Ring', 'ife-coral-signet-ring', 'Rings', 118000,
      'Ife Collection', 'Coral glass cabochon', 'Gold-tone brass',
      'A rounded signet ring set with a rich coral-red cabochon and fine engraved borders.',
      'Inspired by the artistry of Ile-Ife, this confident ring brings a vivid Nigerian accent to a timeless silhouette.',
      'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #54231d 0%, #c95c43 52%, #e8bd70 100%)'
    ),
    (
      'Aso-Oke Twist Band', 'aso-oke-twist-band', 'Rings', 86500,
      'Hand-finished', 'Polished gold finish', '18k gold vermeil',
      'A sculptural crossover band with a softly woven twist and satin highlights.',
      'The interlacing form recalls aso-oke cloth, reimagined as an everyday ring with a warm, tactile finish.',
      'https://images.pexels.com/photos/3266700/pexels-photo-3266700.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'linear-gradient(135deg, #5e421d 0%, #d6aa50 52%, #f0dca7 100%)'
    ),
    (
      'Oja Filigree Crown Ring', 'oja-filigree-crown-ring', 'Rings', 128000,
      'Atelier made', 'Openwork filigree', 'Gold-tone brass',
      'A raised crown ring with fine openwork detail and a softly polished finish.',
      'Its delicate geometry is inspired by artisan metalwork and the lively craft traditions of Nigerian markets.',
      'https://images.unsplash.com/photo-1611085583191-a3b181a88401?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #4a3520 0%, #bd9145 52%, #f1dfb0 100%)'
    ),
    (
      'Benin Bronze Petal Studs', 'benin-bronze-petal-studs', 'Earrings', 79500,
      'New', 'Hammered texture', 'Gold-tone brass',
      'Lightweight petal-shaped studs with a softly hammered bronze-gold surface.',
      'A small wearable nod to the sculptural metalwork traditions of Benin, designed for easy everyday styling.',
      'https://images.pexels.com/photos/1458867/pexels-photo-1458867.jpeg?auto=compress&cs=tinysrgb&w=1200',
      'linear-gradient(135deg, #302219 0%, #a96c34 52%, #e0b75f 100%)'
    ),
    (
      'Lagos Market Disc Drops', 'lagos-market-disc-drops', 'Earrings', 92500,
      'Lagos Edit', 'Brushed gold discs', 'Gold-tone brass',
      'Swinging disc earrings with layered circular forms and a brushed golden finish.',
      'Inspired by the colour and movement of Lagos markets, these statement drops catch the light with every turn.',
      'https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #293c55 0%, #587895 50%, #d9ad52 100%)'
    ),
    (
      'Calabar Coral Petal Hoops', 'calabar-coral-petal-hoops', 'Earrings', 108000,
      'Celebration piece', 'Coral-tone glass beads', 'Gold-tone brass and glass',
      'Open gold-tone hoops finished with a row of coral-coloured petal beads.',
      'A joyful design inspired by Calabar’s festive colour, made to bring a little celebration to special occasions.',
      'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #542221 0%, #cf674d 54%, #efc56a 100%)'
    ),
    (
      'Niger Delta Tide Pendant', 'niger-delta-tide-pendant', 'Necklaces', 126000,
      'Coastal line', 'Blue glass centre stone', 'Gold-tone brass and glass',
      'A fluid gold-tone pendant with a deep-blue centre and rippled, water-like lines.',
      'Its flowing silhouette takes inspiration from the waterways of the Niger Delta and the light on the coast.',
      'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #123c4a 0%, #348194 54%, #d2b16a 100%)'
    ),
    (
      'Nok Terra Bead Necklace', 'nok-terra-bead-necklace', 'Necklaces', 139000,
      'Atelier made', 'Terracotta glass beads', 'Terracotta glass and gold-tone brass',
      'A warm strand of rounded terracotta beads finished with a simple brushed-gold clasp.',
      'A contemporary colour story inspired by the enduring forms of Nok art and the earth tones of northern Nigeria.',
      'https://images.unsplash.com/photo-1611085583191-a3b181a88401?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #4c2921 0%, #b55e3d 54%, #d4a95c 100%)'
    ),
    (
      'Bida Brass Line Bangle', 'bida-brass-line-bangle', 'Bracelets', 112000,
      'Craft classic', 'Fine etched lines', 'Gold-tone brass',
      'A clean open bangle with delicate etched lines and a softly polished surface.',
      'A modern keepsake that celebrates Bida’s renowned brass-working heritage in a light, wearable form.',
      'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #3f3019 0%, #c19843 53%, #f0dfae 100%)'
    ),
    (
      'Adire Indigo Link Bracelet', 'adire-indigo-link-bracelet', 'Bracelets', 102000,
      'Everyday heirloom', 'Indigo enamel detail', 'Gold-tone brass and enamel',
      'A fine-link bracelet accented with indigo enamel drops and a secure gold-tone clasp.',
      'The deep-blue accents recall Yoruba adire patterns and pair easily with other everyday pieces.',
      'https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85',
      'linear-gradient(135deg, #121c3d 0%, #344f82 52%, #d1aa56 100%)'
    )
)
insert into public.products (
  name, slug, category_id, price, badge, gemstone, material, description, story, rating, featured, status, accent
)
select
  product_seed.name,
  product_seed.slug,
  categories.id,
  product_seed.price,
  product_seed.badge,
  product_seed.gemstone,
  product_seed.material,
  product_seed.description,
  product_seed.story,
  4.9,
  true,
  'active',
  product_seed.accent
from product_seed
join public.categories on lower(categories.name) = lower(product_seed.category)
on conflict (slug) do update set
  category_id = excluded.category_id,
  price = excluded.price,
  badge = excluded.badge,
  gemstone = excluded.gemstone,
  material = excluded.material,
  description = excluded.description,
  story = excluded.story,
  featured = excluded.featured,
  status = excluded.status,
  accent = excluded.accent;

delete from public.product_images
using public.products
where product_images.product_id = products.id
  and products.slug in (
    'aso-oke-sunburst-hoops',
    'adire-indigo-bead-necklace',
    'coral-heritage-cuff',
    'lagos-skyline-signet',
    'zaria-filigree-pendant',
    'calabar-tide-pearl-drops',
    'ijebu-gold-bead-bracelet',
    'ife-coral-signet-ring',
    'aso-oke-twist-band',
    'oja-filigree-crown-ring',
    'benin-bronze-petal-studs',
    'lagos-market-disc-drops',
    'calabar-coral-petal-hoops',
    'niger-delta-tide-pendant',
    'nok-terra-bead-necklace',
    'bida-brass-line-bangle',
    'adire-indigo-link-bracelet'
  );

with product_images_seed (slug, image_url) as (
  values
    ('aso-oke-sunburst-hoops', 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1200&q=85'),
    ('adire-indigo-bead-necklace', 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1200&q=85'),
    ('coral-heritage-cuff', 'https://images.unsplash.com/photo-1603561596112-0a132b757442?auto=format&fit=crop&w=1200&q=85'),
    ('lagos-skyline-signet', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1200&q=85'),
    ('zaria-filigree-pendant', 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?auto=format&fit=crop&w=1200&q=85'),
    ('calabar-tide-pearl-drops', 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=1200&q=85'),
    ('ijebu-gold-bead-bracelet', 'https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?auto=format&fit=crop&w=1200&q=85'),
    ('ife-coral-signet-ring', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1200&q=85'),
    ('aso-oke-twist-band', 'https://images.pexels.com/photos/3266700/pexels-photo-3266700.jpeg?auto=compress&cs=tinysrgb&w=1200'),
    ('oja-filigree-crown-ring', 'https://images.unsplash.com/photo-1611085583191-a3b181a88401?auto=format&fit=crop&w=1200&q=85'),
    ('benin-bronze-petal-studs', 'https://images.pexels.com/photos/1458867/pexels-photo-1458867.jpeg?auto=compress&cs=tinysrgb&w=1200'),
    ('lagos-market-disc-drops', 'https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85'),
    ('calabar-coral-petal-hoops', 'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=1200&q=85'),
    ('niger-delta-tide-pendant', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=1200&q=85'),
    ('nok-terra-bead-necklace', 'https://images.unsplash.com/photo-1611085583191-a3b181a88401?auto=format&fit=crop&w=1200&q=85'),
    ('bida-brass-line-bangle', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1200&q=85'),
    ('adire-indigo-link-bracelet', 'https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85')
)
insert into public.product_images (product_id, image_url, alt_text, sort_order)
select products.id, product_images_seed.image_url, products.name, 0
from product_images_seed
join public.products on products.slug = product_images_seed.slug;

commit;
notify pgrst, 'reload schema';

with seeded_products as (
  select unnest(array[
    'aso-oke-sunburst-hoops',
    'adire-indigo-bead-necklace',
    'coral-heritage-cuff',
    'lagos-skyline-signet',
    'zaria-filigree-pendant',
    'calabar-tide-pearl-drops',
    'ijebu-gold-bead-bracelet',
    'ife-coral-signet-ring',
    'aso-oke-twist-band',
    'oja-filigree-crown-ring',
    'benin-bronze-petal-studs',
    'lagos-market-disc-drops',
    'calabar-coral-petal-hoops',
    'niger-delta-tide-pendant',
    'nok-terra-bead-necklace',
    'bida-brass-line-bangle',
    'adire-indigo-link-bracelet'
  ]) as slug
), verified_products as (
  select
    categories.name as category,
    products.status,
    count(product_images.id) as image_count
  from seeded_products
  join public.products on products.slug = seeded_products.slug
  left join public.categories on categories.id = products.category_id
  left join public.product_images on product_images.product_id = products.id
  group by products.id, categories.name, products.status
)
select
  category,
  count(*) as product_count,
  count(*) filter (where status = 'active') as active_count,
  count(*) filter (where image_count = 0) as products_missing_images
from verified_products
group by category
order by category;
