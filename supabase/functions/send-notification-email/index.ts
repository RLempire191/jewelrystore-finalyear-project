declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type NotificationRow = {
  id: string
  user_id: string
  title: string
  message: string
  href: string
  email_sent_at: string | null
}

type ProfileRow = {
  id: string
  email: string
  full_name: string
  marketing_email_opt_in: boolean
}

type SupportMessageRow = {
  id: string
  sender_id: string
  conversation_id: string
  body: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Supabase function secret: ${name}`)
  return value
}

async function supabaseRows<T>(path: string): Promise<T[]> {
  const url = requiredSecret('SUPABASE_URL').replace(/\/+$/, '')
  const serviceRoleKey = requiredSecret('SUPABASE_SERVICE_ROLE_KEY')
  const rows: T[] = []
  let offset = 0
  while (true) {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Range-Unit': 'items',
        Range: `${offset}-${offset + 499}`,
      },
    })
    if (!response.ok) throw new Error('Unable to read notification data.')
    const batch = await response.json() as T[]
    rows.push(...batch)
    if (batch.length < 500) return rows
    offset += 500
  }
}

async function updateSentNotifications(notificationIds: string[]) {
  if (notificationIds.length === 0) return
  const url = requiredSecret('SUPABASE_URL').replace(/\/+$/, '')
  const serviceRoleKey = requiredSecret('SUPABASE_SERVICE_ROLE_KEY')
  for (let index = 0; index < notificationIds.length; index += 100) {
    const ids = new URLSearchParams({
      id: `in.(${notificationIds.slice(index, index + 100).join(',')})`,
    })
    const response = await fetch(
      `${url}/rest/v1/inbox_notifications?${ids.toString()}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ email_sent_at: new Date().toISOString() }),
      },
    )
    if (!response.ok) {
      throw new Error('Email was accepted, but its delivery status could not be saved.')
    }
  }
}

async function sendEmails(notifications: NotificationRow[], profiles: ProfileRow[]) {
  if (notifications.length === 0 || profiles.length === 0) return 0

  const sendGridKey = requiredSecret('SENDGRID_API_KEY')
  const fromEmail = requiredSecret('SENDGRID_FROM_EMAIL')
  const fromName = Deno.env.get('SENDGRID_FROM_NAME')?.trim() || 'Lumina Jewelry'
  const siteUrl = requiredSecret('SITE_URL').replace(/\/+$/, '')
  new URL(siteUrl)

  const deliveries = notifications.flatMap((notification) => {
    const profile = profiles.find((entry) => entry.id === notification.user_id)
    if (!profile?.email) return []
    return [{
      notification,
      email: profile.email,
    }]
  })

  for (let index = 0; index < deliveries.length; index += 100) {
    const batch = deliveries.slice(index, index + 100)
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendGridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: batch.map(({ email }) => ({ to: [{ email }] })),
        from: { email: fromEmail, name: fromName },
        subject: batch[0].notification.title.replace(/[\r\n]+/g, ' ').slice(0, 140),
        content: [{
          type: 'text/plain',
          value:
            `Hello,\n\n${batch[0].notification.message}`
            + `\n\nView this update: ${siteUrl}${batch[0].notification.href}`
            + `\n\nManage email preferences: ${siteUrl}/account#profile`
            + '\n\nLumina Jewelry',
        }],
      }),
    })
    if (response.status < 200 || response.status >= 300) {
      console.error('SendGrid rejected an email notification.', response.status)
      throw new Error('SendGrid could not deliver the email notification.')
    }

    await updateSentNotifications(batch.map(({ notification }) => notification.id))
  }

  return deliveries.length
}

async function loadRecipientProfiles(userIds: string[]) {
  if (userIds.length === 0) return []
  const batches: string[][] = []
  for (let index = 0; index < userIds.length; index += 50) {
    batches.push(userIds.slice(index, index + 50))
  }
  const profileBatches = await Promise.all(batches.map((ids) => {
    const query = new URLSearchParams({
      select: 'id,email,full_name,marketing_email_opt_in',
      id: `in.(${ids.join(',')})`,
    })
    return supabaseRows<ProfileRow>(`profiles?${query.toString()}`)
  }))
  return profileBatches.flat()
}

async function handleSupportMessage(userId: string, messageId: string) {
  const query = new URLSearchParams({
    select: 'id,sender_id,conversation_id,body',
    id: `eq.${messageId}`,
  })
  const [message] = await supabaseRows<SupportMessageRow>(`support_messages?${query.toString()}`)
  if (!message || message.sender_id !== userId) {
    return jsonResponse({ error: 'Support message not found.' }, 404)
  }

  const adminRows = await supabaseRows<{ user_id: string }>('admin_roles?select=user_id')
  const senderIsAdmin = adminRows.some((admin) => admin.user_id === userId)
  const notificationQuery = new URLSearchParams({
    select: 'id,user_id,title,message,href,email_sent_at',
    type: 'eq.support',
    reference_id: `eq.${message.id}`,
    email_sent_at: 'is.null',
  })
  const allNotifications = await supabaseRows<NotificationRow>(
    `inbox_notifications?${notificationQuery.toString()}`,
  )
  const notifications = senderIsAdmin
    ? allNotifications.filter((notification) => notification.user_id !== userId)
    : allNotifications.filter((notification) =>
        adminRows.some((admin) => admin.user_id === notification.user_id),
      )
  const profiles = await loadRecipientProfiles(notifications.map((notification) => notification.user_id))
  const delivered = await sendEmails(notifications, profiles)
  return jsonResponse({ delivered })
}

async function handleProductAnnouncement(userId: string, productId: string) {
  const adminRows = await supabaseRows<{ user_id: string }>(
    `admin_roles?${new URLSearchParams({ user_id: `eq.${userId}`, select: 'user_id' }).toString()}`,
  )
  if (adminRows.length === 0) return jsonResponse({ error: 'Administrator access is required.' }, 403)

  const productQuery = new URLSearchParams({
    select: 'id,status',
    id: `eq.${productId}`,
    status: 'eq.active',
  })
  const [product] = await supabaseRows<{ id: string; status: string }>(
    `products?${productQuery.toString()}`,
  )
  if (!product) return jsonResponse({ error: 'Active product not found.' }, 404)

  const recentlyCreated = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const notificationQuery = new URLSearchParams({
    select: 'id,user_id,title,message,href,email_sent_at',
    type: 'eq.product',
    reference_id: `eq.${productId}`,
    email_sent_at: 'is.null',
    created_at: `gte.${recentlyCreated}`,
  })
  const notifications = await supabaseRows<NotificationRow>(
    `inbox_notifications?${notificationQuery.toString()}`,
  )
  const profiles = await loadRecipientProfiles(notifications.map((notification) => notification.user_id))
  const optedInIds = new Set(
    profiles
      .filter((profile) => profile.marketing_email_opt_in && profile.email)
      .map((profile) => profile.id),
  )
  const optedInNotifications = notifications.filter((notification) =>
    optedInIds.has(notification.user_id),
  )
  const optedInProfiles = profiles.filter((profile) => optedInIds.has(profile.id))
  const delivered = await sendEmails(optedInNotifications, optedInProfiles)

  const skippedIds = notifications
    .filter((notification) => !optedInIds.has(notification.user_id))
    .map((notification) => notification.id)
  await updateSentNotifications(skippedIds)

  return jsonResponse({ delivered })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) return jsonResponse({ error: 'Sign in is required.' }, 401)
    const supabaseUrl = requiredSecret('SUPABASE_URL').replace(/\/+$/, '')
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: requiredSecret('SUPABASE_ANON_KEY'),
        Authorization: authorization,
      },
    })
    if (!authResponse.ok) return jsonResponse({ error: 'Your session is invalid or expired.' }, 401)
    const authenticatedUser = await authResponse.json() as { id?: string }
    if (!authenticatedUser.id) return jsonResponse({ error: 'Your session is invalid.' }, 401)

    const payload = await request.json() as {
      type?: string
      messageId?: string
      productId?: string
    }
    if (payload.type === 'support_message' && payload.messageId) {
      return await handleSupportMessage(authenticatedUser.id, payload.messageId)
    }
    if (payload.type === 'product_announcement' && payload.productId) {
      return await handleProductAnnouncement(authenticatedUser.id, payload.productId)
    }
    return jsonResponse({ error: 'Unsupported email notification request.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email notification failed.'
    console.error('Email notification request failed.', message)
    return jsonResponse({ error: message }, 500)
  }
})
