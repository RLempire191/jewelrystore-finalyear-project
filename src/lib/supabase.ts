import { createClient, type Session } from '@supabase/supabase-js'
import { slugify } from './format'
import { productImageFallback } from './images'
import type {
  Address,
  CheckoutFormState,
  InboxNotification,
  Order,
  OrderStatus,
  PaymentStatus,
  Product,
  ProductCategory,
  ProductFormState,
  ProductStatus,
  SavedAddress,
  SessionUser,
  SupportConversation,
  SupportMessage,
  UserRole,
} from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

type DbProductRow = {
  id: string
  name: string
  slug: string
  price: number
  compare_at_price: number | null
  badge: string | null
  gemstone: string
  material: string
  description: string
  story: string
  rating: number
  featured: boolean
  status: string
  accent: string
  categories: { name: string } | { name: string }[] | null
  product_images: Array<{ image_url: string; sort_order: number }> | null
}

type DbOrderRow = {
  id: string
  order_number: string
  status: string
  payment_status: string
  created_at: string
  customer_name: string
  customer_email: string
  shipping_city: string
  subtotal: number
  shipping_fee: number
  total: number
  note: string
  customer_hidden_at: string | null
  order_items: Array<{ product_id: string | null; quantity: number; price: number }> | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string) {
  return UUID_RE.test(value)
}

function titleCaseStatus(status: string): ProductStatus {
  const normalized = status.toLowerCase()
  if (normalized === 'draft') return 'Draft'
  if (normalized === 'archived') return 'Archived'
  return 'Active'
}

function mapDbOrder(row: DbOrderRow): Order {
  const orderStatus = row.status[0]?.toUpperCase() + row.status.slice(1).toLowerCase()
  const paymentStatus = row.payment_status[0]?.toUpperCase() + row.payment_status.slice(1).toLowerCase()
  const validOrderStatuses: OrderStatus[] = ['Processing', 'Crafting', 'Shipped', 'Delivered', 'Cancelled']
  const validPaymentStatuses: PaymentStatus[] = ['Pending', 'Paid', 'Refunded']

  if (!validOrderStatuses.includes(orderStatus as OrderStatus)) {
    throw new Error(`Supabase returned an unsupported order status: ${row.status}`)
  }
  if (!validPaymentStatuses.includes(paymentStatus as PaymentStatus)) {
    throw new Error(`Supabase returned an unsupported payment status: ${row.payment_status}`)
  }

  return {
    id: row.id,
    number: row.order_number,
    status: orderStatus as OrderStatus,
    paymentStatus: paymentStatus as PaymentStatus,
    createdAt: row.created_at,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    shippingCity: row.shipping_city,
    items: (row.order_items ?? []).map((item) => ({
      productId: item.product_id ?? '',
      quantity: Number(item.quantity),
      price: Number(item.price),
    })),
    subtotal: Number(row.subtotal),
    shippingFee: Number(row.shipping_fee),
    total: Number(row.total),
    note: row.note,
  }
}

function normalizeCategoryName(value: string): ProductCategory {
  const categories: ProductCategory[] = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Watches']
  const match = categories.find((category) => category.toLowerCase() === value.toLowerCase())
  return match ?? 'Rings'
}

function mapDbProduct(row: DbProductRow): Product {
  const categorySource = Array.isArray(row.categories)
    ? row.categories[0]?.name
    : row.categories?.name
  const images = [...(row.product_images ?? [])].sort(
    (left, right) => left.sort_order - right.sort_order,
  )
  const [primaryImage, ...galleryImages] = images

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: normalizeCategoryName(categorySource ?? 'Rings'),
    image: primaryImage?.image_url ?? productImageFallback,
    gallery: galleryImages.map((entry) => entry.image_url),
    price: Number(row.price),
    compareAtPrice: row.compare_at_price ? Number(row.compare_at_price) : undefined,
    badge: row.badge ?? undefined,
    gemstone: row.gemstone,
    material: row.material,
    description: row.description,
    story: row.story,
    rating: Number(row.rating),
    featured: row.featured,
    status: titleCaseStatus(row.status),
    accent: row.accent,
  }
}

async function getCategoryId(category: ProductCategory) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.from('categories').select('id, name')
  if (error) {
    throw new Error(error.message)
  }

  const categoryId = data?.find((entry) => entry.name.toLowerCase() === category.toLowerCase())?.id
  if (!categoryId) {
    throw new Error(`The "${category}" category is missing in Supabase. Run the catalog SQL setup, then try again.`)
  }

  return categoryId
}

export async function fetchSessionUser(session: Session | null): Promise<SessionUser | null> {
  if (!supabase || !session?.user) {
    return null
  }

  const userId = session.user.id
  const [{ data: profile, error: profileError }, { data: adminRole, error: adminError }] =
    await Promise.all([
      supabase.from('profiles')
        .select('full_name, email, city, state, phone, role, marketing_email_opt_in')
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('admin_roles').select('user_id').eq('user_id', userId).maybeSingle(),
    ])

  const metadata = session.user.user_metadata ?? {}
  const role: UserRole =
    !adminError && (adminRole?.user_id || profile?.role === 'admin') ? 'admin' : 'customer'

  return {
    id: userId,
    name:
      (!profileError && profile?.full_name) ||
      (typeof metadata.full_name === 'string' ? metadata.full_name : '') ||
      session.user.email?.split('@')[0] ||
      'Collector',
    email: (!profileError && profile?.email) || session.user.email || '',
    role,
    city:
      (!profileError && profile?.city) ||
      (typeof metadata.city === 'string' ? metadata.city : '') ||
      'Lagos',
    state: (!profileError && profile?.state) || (typeof metadata.state === 'string' ? metadata.state : ''),
    phone: (!profileError && profile?.phone) || (typeof metadata.phone === 'string' ? metadata.phone : ''),
    marketingEmailOptIn:
      (!profileError && profile?.marketing_email_opt_in === true)
      || metadata.marketing_email_opt_in === true,
  }
}

export async function updateUserProfile(
  userId: string,
  currentEmail: string,
  profile: {
    name: string
    email: string
    phone: string
    city: string
    state: string
    marketingEmailOptIn: boolean
  },
) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const emailChanged = currentEmail.toLowerCase() !== profile.email.toLowerCase()
  const { data: savedProfile, error: profileError } = await supabase
    .from('profiles')
    .update({
      full_name: profile.name,
      phone: profile.phone,
      city: profile.city,
      state: profile.state,
      marketing_email_opt_in: profile.marketingEmailOptIn,
    })
    .eq('id', userId)
    .select('id')
    .maybeSingle()

  if (profileError) {
    throwAccountSchemaSetupError(profileError, 'profile')
  }
  if (!savedProfile) {
    throw new Error('Your account profile could not be found. Sign out and sign back in, then try again.')
  }

  let savedEmail = currentEmail
  if (emailChanged) {
    const { data: authData, error: authError } = await supabase.auth.updateUser({ email: profile.email })
    if (authError) {
      throw authError
    }
    savedEmail = authData.user.email ?? currentEmail
  }

  return {
    name: profile.name,
    email: savedEmail,
    phone: profile.phone,
    city: profile.city,
    state: profile.state,
    marketingEmailOptIn: profile.marketingEmailOptIn,
    emailChangePending: emailChanged && savedEmail.toLowerCase() !== profile.email.toLowerCase(),
  }
}

function throwAccountSchemaSetupError(
  error: { code?: string; message?: string },
  feature: 'profile' | 'addresses',
): never {
  const errorMessage = error.message?.toLowerCase() ?? ''
  const schemaIsMissing =
    ['PGRST204', 'PGRST205', '42P01', '42703'].includes(error.code ?? '') ||
    errorMessage.includes('schema cache') ||
    (errorMessage.includes('does not exist') && (errorMessage.includes('table') || errorMessage.includes('column')))

  if (schemaIsMissing) {
    const requiredSetup = feature === 'profile' ? 'required profile fields' : 'the saved-address table'
    const migrations = feature === 'profile'
      ? 'supabase/customer_profile_and_addresses.sql and supabase/customer_messaging_inbox.sql'
      : 'supabase/customer_profile_and_addresses.sql'
    throw new Error(
      `Supabase is missing ${requiredSetup}. Run ${migrations} in the Supabase SQL Editor, then reload and try again.`,
    )
  }

  throw error
}

type DbUserAddress = {
  id: string
  label: string
  full_name: string
  phone: string
  street: string
  city: string
  state: string
  country: string
  is_default: boolean
}

function mapUserAddress(row: DbUserAddress): SavedAddress {
  return {
    id: row.id,
    label: row.label,
    fullName: row.full_name,
    phone: row.phone,
    street: row.street,
    city: row.city,
    state: row.state,
    country: row.country,
    isDefault: row.is_default,
  }
}

export async function fetchUserAddresses(userId: string): Promise<SavedAddress[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase
    .from('user_addresses')
    .select('id, label, full_name, phone, street, city, state, country, is_default')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throwAccountSchemaSetupError(error, 'addresses')
  }

  return (data ?? []).map(mapUserAddress)
}

export async function saveUserAddress(userId: string, address: SavedAddress): Promise<SavedAddress> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const record = {
    ...(address.id ? { id: address.id } : {}),
    user_id: userId,
    label: address.label,
    full_name: address.fullName,
    phone: address.phone,
    street: address.street,
    city: address.city,
    state: address.state,
    country: address.country,
    is_default: address.isDefault,
  }
  const { data, error } = await supabase
    .from('user_addresses')
    .upsert(record)
    .select('id, label, full_name, phone, street, city, state, country, is_default')
    .single()

  if (error) {
    throwAccountSchemaSetupError(error, 'addresses')
  }

  return mapUserAddress(data)
}

export async function deleteUserAddress(userId: string, addressId: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase
    .from('user_addresses')
    .delete()
    .eq('user_id', userId)
    .eq('id', addressId)

  if (error) {
    throwAccountSchemaSetupError(error, 'addresses')
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Messaging is unavailable in local demo mode.')
  }
  return supabase
}

export async function fetchInboxNotifications(): Promise<InboxNotification[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('inbox_notifications')
    .select('id, type, title, message, href, conversation_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type as InboxNotification['type'],
    title: row.title,
    message: row.message,
    href: row.href,
    conversationId: row.conversation_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }))
}

export async function markInboxNotificationRead(notificationId: string): Promise<void> {
  const client = requireSupabase()
  const { error } = await client
    .from('inbox_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (error) throw error
}

export async function fetchSupportConversations(): Promise<SupportConversation[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('support_conversations')
    .select('id, user_id, updated_at')
    .order('updated_at', { ascending: false })

  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []

  const userIds = [...new Set(rows.map((row) => row.user_id))]
  const { data: profiles, error: profileError } = await client
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)

  if (profileError) throw profileError
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

  return rows.map((row) => {
    const profile = profileById.get(row.user_id)
    return {
      id: row.id,
      userId: row.user_id,
      customerName: profile?.full_name || 'Lumina customer',
      customerEmail: profile?.email || '',
      updatedAt: row.updated_at,
    }
  })
}

export async function fetchSupportMessages(conversationId: string): Promise<SupportMessage[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('support_messages')
    .select('id, conversation_id, sender_id, body, created_at, read_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  }))
}

export async function getOrCreateSupportConversation(userId: string): Promise<string> {
  const client = requireSupabase()
  const { data: existing, error: lookupError } = await client
    .from('support_conversations')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (lookupError) throw lookupError
  if (existing) return existing.id

  const { data: created, error: createError } = await client
    .from('support_conversations')
    .insert({ user_id: userId, subject: 'Customer support' })
    .select('id')
    .single()

  if (createError?.code === '23505') {
    const { data: raced, error: retryError } = await client
      .from('support_conversations')
      .select('id')
      .eq('user_id', userId)
      .single()
    if (retryError) throw retryError
    return raced.id
  }
  if (createError) throw createError
  return created.id
}

export async function sendSupportMessage(conversationId: string, body: string): Promise<string> {
  const client = requireSupabase()
  const { data, error } = await client
    .from('support_messages')
    .insert({ conversation_id: conversationId, body: body.trim() })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function sendSupportMessageEmail(messageId: string): Promise<void> {
  const client = requireSupabase()
  const { error } = await client.functions.invoke('send-notification-email', {
    body: { type: 'support_message', messageId },
  })

  if (error) throw new Error(error.message)
}

export async function sendProductAnnouncementEmail(productId: string): Promise<void> {
  const client = requireSupabase()
  const { error } = await client.functions.invoke('send-notification-email', {
    body: { type: 'product_announcement', productId },
  })

  if (error) throw new Error(error.message)
}

export async function markSupportMessagesRead(
  conversationId: string,
  senderId: string,
): Promise<void> {
  const client = requireSupabase()
  const { error } = await client
    .from('support_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('sender_id', senderId)
    .is('read_at', null)

  if (error) throw error
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw error
  }

  const user = await fetchSessionUser(data.session)
  if (!user) {
    throw new Error('Unable to load your profile.')
  }

  return user
}

export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
  city: string,
  state: string,
  marketingEmailOptIn: boolean,
) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo:
        typeof window !== 'undefined' ? `${window.location.origin}/auth/confirmed` : undefined,
      data: {
        full_name: name,
        city,
        state,
        marketing_email_opt_in: marketingEmailOptIn,
      },
    },
  })

  if (error) {
    throw error
  }

  if (!data.session) {
    return { user: null, needsEmailConfirmation: true }
  }

  const user = await fetchSessionUser(data.session)
  return { user, needsEmailConfirmation: false }
}

export async function sendPasswordResetEmail(email: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  })

  if (error) {
    throw error
  }
}

export async function signOutFromSupabase() {
  if (!supabase) {
    return
  }

  const { error } = await supabase.auth.signOut()
  if (error) {
    throw error
  }
}

export async function fetchProducts(): Promise<Product[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase
    .from('products')
    .select(
      `
      id,
      name,
      slug,
      price,
      compare_at_price,
      badge,
      gemstone,
      material,
      description,
      story,
      rating,
      featured,
      status,
      accent,
      categories(name),
      product_images(image_url, sort_order)
    `,
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data as DbProductRow[]).map(mapDbProduct)
}

export async function saveProductRecord(form: ProductFormState): Promise<Product> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const categoryId = await getCategoryId(form.category)
  const payload = {
    name: form.name.trim(),
    slug: form.slug.trim() || slugify(form.name),
    category_id: categoryId,
    price: Number(form.price) || 0,
    compare_at_price: form.compareAtPrice.trim() ? Number(form.compareAtPrice) : null,
    badge: form.badge.trim() || null,
    gemstone: form.gemstone.trim(),
    material: form.material.trim(),
    description: form.description.trim(),
    story: form.story.trim(),
    rating: Number(form.rating) || 4.8,
    featured: form.featured,
    status: form.status.toLowerCase(),
    accent: form.accent.trim(),
  }

  let productId = form.id?.trim() ?? ''

  if (productId && isUuid(productId)) {
    const { error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', productId)
      .select(
        `
        id,
        name,
        slug,
        price,
        compare_at_price,
        badge,
        gemstone,
        material,
        description,
        story,
        rating,
        featured,
        status,
        accent,
        categories(name),
        product_images(image_url, sort_order)
      `,
      )
      .single()

    if (error) {
      throw new Error(error.message)
    }
  } else {
    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select(
        `
        id,
        name,
        slug,
        price,
        compare_at_price,
        badge,
        gemstone,
        material,
        description,
        story,
        rating,
        featured,
        status,
        accent,
        categories(name),
        product_images(image_url, sort_order)
      `,
      )
      .single()

    if (error) {
      throw new Error(error.message)
    }

    productId = (data as DbProductRow).id
  }

  const imageUrl = form.image.trim()
  if (imageUrl) {
    const { error: deleteError } = await supabase
      .from('product_images')
      .delete()
      .eq('product_id', productId)

    if (deleteError) {
      throw new Error(deleteError.message)
    }

    const { error: insertError } = await supabase.from('product_images').insert({
      product_id: productId,
      image_url: imageUrl,
      alt_text: form.name.trim(),
      sort_order: 0,
    })

    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  const { data: refreshed, error: refreshError } = await supabase
    .from('products')
    .select(
      `
      id,
      name,
      slug,
      price,
      compare_at_price,
      badge,
      gemstone,
      material,
      description,
      story,
      rating,
      featured,
      status,
      accent,
      categories(name),
      product_images(image_url, sort_order)
    `,
    )
    .eq('id', productId)
    .single()

  if (refreshError) {
    throw new Error(refreshError.message)
  }

  return mapDbProduct(refreshed as DbProductRow)
}

export async function createOrderRecord(payload: {
  address: Address
  items: Array<{ productId: string; quantity: number; price: number }>
  subtotal: number
  shippingFee: number
  total: number
  paymentMethod: CheckoutFormState['paymentMethod']
  note?: string
}) {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.rpc('create_order_with_items', {
    order_payload: {
      customer_name: payload.address.fullName,
      customer_email: payload.address.email,
      shipping_city: payload.address.city,
      shipping_state: payload.address.state,
      shipping_country: payload.address.country,
      shipping_street: payload.address.street,
      payment_method: payload.paymentMethod,
      subtotal: payload.subtotal,
      shipping_fee: payload.shippingFee,
      total: payload.total,
      note: payload.note ?? '',
      items: payload.items,
    },
  })

  if (error) {
    throw new Error(error.message)
  }

  return Array.isArray(data) ? data[0] ?? null : data
}

export async function fetchOrders(includeCustomerHidden = false): Promise<Order[]> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  let query = supabase
    .from('orders')
    .select(`
      id,
      order_number,
      status,
      payment_status,
      created_at,
      customer_name,
      customer_email,
      shipping_city,
      subtotal,
      shipping_fee,
      total,
      note,
      customer_hidden_at,
      order_items(product_id, quantity, price)
    `)
    .order('created_at', { ascending: false })

  if (!includeCustomerHidden) {
    query = query.is('customer_hidden_at', null)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return (data as DbOrderRow[]).map(mapDbOrder)
}

export async function hideCancelledOrderRecord(orderId: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  if (!isUuid(orderId)) {
    throw new Error('This order is not a Supabase order record.')
  }

  const { data, error } = await supabase.rpc('customer_hide_cancelled_order', {
    target_order_id: orderId,
  })

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Supabase did not confirm that the cancelled order was hidden.')
  }
}

export async function updateOrderStatusRecord(orderId: string, status: OrderStatus): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.rpc('admin_update_order_status', {
    target_order_id: orderId,
    new_status: status.toLowerCase(),
  })

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Supabase did not confirm the order status update.')
  }
}

export async function deleteProductRecord(productId: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }
  if (!isUuid(productId)) {
    throw new Error('This product is not a Supabase product record and cannot be deleted from the live catalog.')
  }

  const { data, error } = await supabase.rpc('admin_delete_product', {
    target_product_id: productId,
  })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Supabase did not confirm that the product was deleted.')
  }
}
