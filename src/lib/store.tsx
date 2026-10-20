/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  type ReactNode,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { seedProducts } from './mockData'
import { slugify } from './format'
import {
  createOrderRecord,
  deleteProductRecord,
  fetchOrders,
  fetchProducts,
  fetchSessionUser,
  hasSupabaseConfig,
  hideCancelledOrderRecord,
  saveProductRecord,
  sendPasswordResetEmail,
  sendProductAnnouncementEmail,
  signInWithEmail,
  signOutFromSupabase,
  signUpWithEmail,
  supabase,
  updateUserProfile,
  updateOrderStatusRecord,
} from './supabase'
import type {
  CartItem,
  CheckoutFormState,
  CheckoutPaymentMeta,
  Order,
  OrderStatus,
  Product,
  ProductFormState,
  SessionUser,
  StoreState,
  UserRole,
  Toast,
  ToastPosition,
} from './types'

const STORAGE_KEY = 'lumina-store-v2'

type PersistedStoreSlice = Pick<StoreState, 'cart' | 'wishlist' | 'orders' | 'lastOrderId'>

type StoreAction =
  | { type: 'sign-in'; user: SessionUser }
  | { type: 'sign-out' }
  | { type: 'set-user'; user: SessionUser | null }
  | { type: 'set-products'; products: Product[] }
  | { type: 'set-orders'; orders: Order[] }
  | { type: 'hide-order'; orderId: string }
  | { type: 'remove-product'; productId: string }
  | { type: 'toggle-wishlist'; productId: string }
  | { type: 'add-to-cart'; productId: string; quantity?: number }
  | { type: 'set-cart-quantity'; productId: string; quantity: number }
  | { type: 'remove-from-cart'; productId: string }
  | { type: 'commit-order'; order: Order }
  | { type: 'set-admin-view'; view: StoreState['adminView'] }
  | { type: 'upsert-product'; product: Product }
  | { type: 'update-order-status'; orderId: string; status: OrderStatus }
  | { type: 'hydrate'; state: Partial<StoreState> }

const defaultState: StoreState = {
  user: null,
  products: hasSupabaseConfig ? [] : seedProducts,
  cart: [],
  wishlist: [],
  orders: [],
  lastOrderId: null,
  adminView: 'dashboard',
}

function safeParse(json: string | null): PersistedStoreSlice | null {
  if (!json) {
    return null
  }

  try {
    return JSON.parse(json) as PersistedStoreSlice
  } catch {
    return null
  }
}

function mergeCartItems(primary: CartItem[], incoming: CartItem[]) {
  const quantities = new Map(primary.map((item) => [item.productId, item.quantity]))
  for (const item of incoming) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity)
  }
  return Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }))
}

function makeOrderNumber(existingOrders: Order[]) {
  const next = existingOrders.length + 1
  return `LM-${String(9283 + next).padStart(4, '0')}`
}

function createUser(
  role: UserRole,
  name: string,
  email: string,
  city: string,
  state = '',
  marketingEmailOptIn = false,
): SessionUser {
  return {
    id: `${role}-${slugify(email)}`,
    name,
    email,
    role,
    city,
    state,
    marketingEmailOptIn,
  }
}

function formToProduct(form: ProductFormState): Product {
  const parsedPrice = Number(form.price)
  const parsedCompareAt = Number(form.compareAtPrice)
  const parsedRating = Number(form.rating)

  return {
    id: form.id?.trim() || form.slug || slugify(form.name),
    slug: form.slug || slugify(form.name),
    name: form.name.trim(),
    category: form.category,
    image: form.image.trim(),
    gallery: form.gallery
      ? form.gallery
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean)
      : [],
    price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
    compareAtPrice: Number.isFinite(parsedCompareAt) ? parsedCompareAt : undefined,
    badge: form.badge.trim() || undefined,
    gemstone: form.gemstone.trim(),
    material: form.material.trim(),
    description: form.description.trim(),
    story: form.story.trim(),
    rating: Number.isFinite(parsedRating) ? parsedRating : 4.8,
    featured: form.featured,
    status: form.status,
    accent: form.accent,
  }
}

function reducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'hydrate':
      return { ...state, ...action.state }
    case 'sign-in':
      return {
        ...state,
        user: action.user,
      }
    case 'set-user':
      return {
        ...state,
        user: action.user,
      }
    case 'set-products':
      return {
        ...state,
        products: action.products,
        wishlist: state.wishlist.filter((productId) =>
          action.products.some((product) => product.id === productId),
        ),
      }
    case 'set-orders':
      return {
        ...state,
        orders: action.orders,
      }
    case 'hide-order':
      return {
        ...state,
        orders: state.orders.filter((order) => order.id !== action.orderId),
      }
    case 'remove-product':
      return {
        ...state,
        products: state.products.filter((product) => product.id !== action.productId),
        wishlist: state.wishlist.filter((productId) => productId !== action.productId),
        cart: state.cart.filter((item) => item.productId !== action.productId),
      }
    case 'sign-out':
      return {
        ...state,
        user: null,
      }
    case 'toggle-wishlist': {
      const exists = state.wishlist.includes(action.productId)
      return {
        ...state,
        wishlist: exists
          ? state.wishlist.filter((id) => id !== action.productId)
          : [...state.wishlist, action.productId],
      }
    }
    case 'add-to-cart': {
      const quantity = action.quantity ?? 1
      const existing = state.cart.find((item) => item.productId === action.productId)

      if (existing) {
        return {
          ...state,
          cart: state.cart.map((item) =>
            item.productId === action.productId
              ? { ...item, quantity: item.quantity + quantity }
              : item,
          ),
        }
      }

      return {
        ...state,
        cart: [...state.cart, { productId: action.productId, quantity }],
      }
    }
    case 'set-cart-quantity':
      return {
        ...state,
        cart: state.cart
          .map((item) =>
            item.productId === action.productId
              ? { ...item, quantity: action.quantity }
              : item,
          )
          .filter((item) => item.quantity > 0),
      }
    case 'remove-from-cart':
      return {
        ...state,
        cart: state.cart.filter((item) => item.productId !== action.productId),
      }
    case 'commit-order':
      return {
        ...state,
        orders: [action.order, ...state.orders],
        cart: [],
        lastOrderId: action.order.id,
      }
    case 'set-admin-view':
      return { ...state, adminView: action.view }
    case 'upsert-product': {
      const product = action.product
      const index = state.products.findIndex((entry) => entry.id === product.id)
      const products =
        index >= 0
          ? state.products.map((entry) => (entry.id === product.id ? product : entry))
          : [product, ...state.products]

      return { ...state, products }
    }
    case 'update-order-status':
      return {
        ...state,
        orders: state.orders.map((order) =>
          order.id === action.orderId ? { ...order, status: action.status } : order,
        ),
      }
    default:
      return state
  }
}

interface StoreContextValue {
  state: StoreState
  authReady: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string, city: string, state: string, marketingEmailOptIn: boolean) => Promise<string | null>
  updateProfile: (profile: { name: string; email: string; phone: string; city: string; state: string; marketingEmailOptIn: boolean }) => Promise<string | null>
  resetPassword: (email: string) => Promise<string>
  demoSignIn: (role: UserRole, name: string, email: string) => void
  signOut: () => Promise<void>
  toggleWishlist: (productId: string) => void
  addToCart: (productId: string, quantity?: number) => void
  setCartQuantity: (productId: string, quantity: number) => void
  removeFromCart: (productId: string) => void
  placeOrder: (address: CheckoutFormState, payment?: CheckoutPaymentMeta) => Promise<string>
  setAdminView: (view: StoreState['adminView']) => void
  upsertProduct: (product: ProductFormState) => Promise<Product>
  deleteProduct: (productId: string) => Promise<void>
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>
  hideCancelledOrder: (orderId: string) => Promise<void>
  toasts: Toast[]
  toastPosition: ToastPosition
  showToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  setToastPosition: (position: ToastPosition) => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(!hasSupabaseConfig)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [toastPosition, setToastPositionState] = useState<ToastPosition>(() => {
    if (typeof window !== 'undefined') {
      const persisted = window.localStorage.getItem('lumina-toast-position')
      if (persisted === 'top' || persisted === 'bottom') {
        return persisted
      }
    }
    return 'top'
  })

  const setToastPosition = useCallback((position: ToastPosition) => {
    setToastPositionState(position)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('lumina-toast-position', position)
    }
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const newToast: Toast = { ...toast, id }
    setToasts((current) => [...current, newToast].slice(-4))
  }, [])
  const [state, dispatch] = useReducer(reducer, defaultState, (initialState) => {
    if (typeof window === 'undefined') {
      return initialState
    }

    const anonymousKey = `${STORAGE_KEY}_anonymous`
    let persistedStr = window.localStorage.getItem(anonymousKey)
    if (!persistedStr) {
      persistedStr = window.localStorage.getItem(STORAGE_KEY)
    }
    const persisted = safeParse(persistedStr)
    return persisted ? { ...initialState, ...persisted } : initialState
  })

  const currentUserId = state.user?.id
  const pendingHydrationUserId = useRef<string | null>(null)

  // Load user data on auth change, carrying guest selections into the new account.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const userId = currentUserId ?? 'anonymous'

    const accountKey = currentUserId ? `${STORAGE_KEY}_${currentUserId}` : `${STORAGE_KEY}_anonymous`
    const persisted = safeParse(window.localStorage.getItem(accountKey))
    let cart = persisted?.cart ?? []
    let wishlist = persisted?.wishlist ?? []
    pendingHydrationUserId.current = userId

    if (currentUserId) {
      const guestKey = `${STORAGE_KEY}_anonymous`
      const guestData =
        safeParse(window.localStorage.getItem(guestKey)) ??
        safeParse(window.localStorage.getItem(STORAGE_KEY))

      if (guestData) {
        cart = mergeCartItems(cart, guestData.cart ?? [])
        wishlist = [...new Set([...wishlist, ...(guestData.wishlist ?? [])])]
      }

      window.localStorage.removeItem(guestKey)
      window.localStorage.removeItem(STORAGE_KEY)
    }

    dispatch({
      type: 'hydrate',
      state: {
        cart,
        wishlist,
        orders: hasSupabaseConfig ? [] : persisted?.orders ?? [],
        lastOrderId: persisted?.lastOrderId ?? null,
      },
    })
  }, [currentUserId])

  // Save user data
  useEffect(() => {
    if (typeof window === 'undefined') return
    const userId = currentUserId ?? 'anonymous'

    if (pendingHydrationUserId.current === userId) {
      pendingHydrationUserId.current = null
      return
    }

    const key = currentUserId ? `${STORAGE_KEY}_${currentUserId}` : `${STORAGE_KEY}_anonymous`
    const slice: PersistedStoreSlice = {
      cart: state.cart,
      wishlist: state.wishlist,
      orders: state.orders,
      lastOrderId: state.lastOrderId,
    }
    window.localStorage.setItem(key, JSON.stringify(slice))
  }, [currentUserId, state.cart, state.wishlist, state.orders, state.lastOrderId])

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      return
    }

    const client = supabase
    let active = true
    let authEventRevision = 0

    async function bootstrap() {
      try {
        const [{ data: sessionData }, products] = await Promise.all([
          client.auth.getSession(),
          fetchProducts().catch(() => null),
        ])

        if (!active) {
          return
        }

        if (products) {
          dispatch({ type: 'set-products', products })
        }

        const initialAuthRevision = authEventRevision
        const user = await fetchSessionUser(sessionData.session)
        if (active && initialAuthRevision === authEventRevision) {
          dispatch({ type: 'set-user', user })
        }
      } finally {
        if (active) {
          setAuthReady(true)
        }
      }
    }

    bootstrap()

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      const eventRevision = ++authEventRevision

      // Supabase auth callbacks run while its auth lock is held. Defer profile
      // queries until after the callback returns to avoid deadlocking sign-in.
      window.setTimeout(() => {
        void fetchSessionUser(session)
          .then((user) => {
            if (active && eventRevision === authEventRevision) {
              dispatch({ type: 'set-user', user })
            }
          })
          .catch((error: unknown) => {
            if (!active || eventRevision !== authEventRevision) {
              return
            }

            showToast({
              message: 'Unable to refresh your account',
              description: error instanceof Error ? error.message : 'Please reload and try again.',
              type: 'error',
              icon: 'error',
            })
          })
      }, 0)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [showToast])

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || !currentUserId) {
      return
    }

    let active = true
    let hasReportedError = false
    const refreshOrders = async () => {
      try {
        const orders = await fetchOrders(state.user?.role === 'admin')
        if (active) {
          dispatch({ type: 'set-orders', orders })
          hasReportedError = false
        }
      } catch (error) {
        if (active && !hasReportedError) {
          hasReportedError = true
          showToast({
            message: 'Unable to load orders',
            description: error instanceof Error ? error.message : 'Check order table permissions and reload.',
            type: 'error',
            icon: 'error',
          })
        }
      }
    }

    void refreshOrders()
    const interval = window.setInterval(() => void refreshOrders(), 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [currentUserId, showToast, state.user?.role])

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      return
    }

    let active = true
    let hasReportedError = false
    const refreshProducts = async () => {
      try {
        const products = await fetchProducts()
        if (active) {
          dispatch({ type: 'set-products', products })
          hasReportedError = false
        }
      } catch (error) {
        if (active && !hasReportedError) {
          hasReportedError = true
          showToast({
            message: 'Unable to refresh products',
            description: error instanceof Error ? error.message : 'Check your Supabase product setup.',
            type: 'error',
            icon: 'error',
          })
        }
      }
    }

    void refreshProducts()
    const interval = window.setInterval(() => void refreshProducts(), 30000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [showToast])

  const value: StoreContextValue = {
    state,
    authReady,
    toasts,
    toastPosition,
    showToast,
    dismissToast,
    setToastPosition,
    demoSignIn: (role, name, email, city = 'Lagos') => {
      dispatch({ type: 'sign-in', user: createUser(role, name, email, city) })
      showToast({
        message: 'Welcome back',
        description: `Signed in as ${name} (${role === 'admin' ? 'Atelier Admin' : 'Valued Collector'}).`,
        type: 'gold',
        icon: 'login',
      })
    },
    signIn: async (email, password) => {
      if (!hasSupabaseConfig) {
        dispatch({
          type: 'sign-in',
          user: createUser('customer', email.split('@')[0] || 'Collector', email, 'Lagos'),
        })
        showToast({
          message: 'Welcome back',
          description: `Signed in successfully.`,
          type: 'gold',
          icon: 'login',
        })
        return
      }

      const user = await signInWithEmail(email, password)
      dispatch({ type: 'sign-in', user })
      showToast({
        message: 'Welcome back',
        description: `Signed in as ${user.name}.`,
        type: 'gold',
        icon: 'login',
      })
    },
    signUp: async (name, email, password, city, stateName, marketingEmailOptIn) => {
      if (!hasSupabaseConfig) {
        dispatch({
          type: 'sign-in',
          user: createUser('customer', name, email, city, stateName, marketingEmailOptIn),
        })
        showToast({
          message: 'Account Created',
          description: `Welcome to Lumina, ${name}!`,
          type: 'gold',
          icon: 'how_to_reg',
        })
        return null
      }

      const result = await signUpWithEmail(
        email,
        password,
        name,
        city,
        stateName,
        marketingEmailOptIn,
      )
      if (result.user) {
        dispatch({ type: 'sign-in', user: result.user })
        showToast({
          message: 'Account Created',
          description: `Welcome to Lumina, ${name}!`,
          type: 'gold',
          icon: 'how_to_reg',
        })
      } else if (result.needsEmailConfirmation) {
        showToast({
          message: 'Confirm your email',
          description: 'We sent you a confirmation link. Open it to finish creating your account.',
          type: 'success',
          icon: 'mark_email_read',
        })
      }

      return result.needsEmailConfirmation
        ? 'Check your email to confirm your account before signing in.'
        : null
    },
    updateProfile: async (profile) => {
      if (!state.user) {
        throw new Error('Sign in before updating your profile.')
      }

      const emailChanged = state.user.email.toLowerCase() !== profile.email.toLowerCase()
      let emailChangePending = false
      let updatedUser: SessionUser

      if (hasSupabaseConfig) {
        const result = await updateUserProfile(state.user.id, state.user.email, profile)
        emailChangePending = result.emailChangePending
        updatedUser = {
          ...state.user,
          name: result.name,
          email: result.email,
          phone: result.phone,
          city: result.city,
          state: result.state,
          marketingEmailOptIn: result.marketingEmailOptIn,
        }
      } else {
        updatedUser = { ...state.user, ...profile }
      }

      dispatch({ type: 'set-user', user: updatedUser })
      showToast({
        message: 'Profile updated',
        description: 'Your contact details and email preferences have been saved.',
        type: 'success',
        icon: 'check_circle',
      })

      if (emailChangePending) {
        return `Confirm the email-change link sent to ${profile.email}. Your current email remains ${state.user.email} until the change is confirmed.`
      }

      return emailChanged
        ? 'Your profile is updated and your email change is confirmed.'
        : null
    },
    resetPassword: async (email) => {
      if (!hasSupabaseConfig) {
        return 'Password reset is available when Supabase is connected. For now, contact Lumina support to recover your account.'
      }

      await sendPasswordResetEmail(email)
      showToast({
        message: 'Reset email sent',
        description: 'Check your inbox for the password reset link.',
        type: 'success',
        icon: 'mark_email_read',
      })
      return 'Check your email for a secure password reset link.'
    },
    signOut: async () => {
      if (hasSupabaseConfig) {
        await signOutFromSupabase()
      }
      dispatch({ type: 'sign-out' })
      showToast({
        message: 'Signed out',
        description: 'You have successfully signed out of the atelier.',
        type: 'info',
        icon: 'logout',
      })
    },
    toggleWishlist: (productId) => {
      const product = state.products.find((entry) => entry.id === productId)
      if (!product) {
        showToast({
          message: 'Piece unavailable',
          description: 'We could not find that piece in the current collection.',
          type: 'error',
          icon: 'error',
        })
        return
      }
      dispatch({ type: 'toggle-wishlist', productId })
      const wasInWishlist = state.wishlist.includes(productId)
      showToast({
        message: wasInWishlist ? 'Removed from wishlist' : 'Saved to wishlist',
        description: wasInWishlist
          ? `${product.name} removed from your saved items.`
          : `${product.name} saved for later.`,
        type: 'gold',
        icon: wasInWishlist ? 'heart_broken' : 'favorite',
      })
    },
    addToCart: (productId, quantity) => {
      const product = state.products.find((entry) => entry.id === productId)
      if (!product || !Number.isInteger(quantity ?? 1) || (quantity ?? 1) < 1) {
        showToast({
          message: 'Could not add this piece',
          description: 'Please refresh the collection and try again.',
          type: 'error',
          icon: 'error',
        })
        return
      }
      dispatch({ type: 'add-to-cart', productId, quantity })
      showToast({
        message: `${product.name} added to bag`,
        description: `A custom selection has been added to your shopping bag.`,
        type: 'gold',
        icon: 'shopping_bag',
        action: {
          label: 'View Bag',
          onClick: () => {
            window.history.pushState({}, '', '/bag')
            window.dispatchEvent(new PopStateEvent('popstate'))
          }
        }
      })
    },
    setCartQuantity: (productId, quantity) => {
      const product = state.products.find((entry) => entry.id === productId)
      const cartItem = state.cart.find((entry) => entry.productId === productId)
      if (!product || !cartItem || !Number.isInteger(quantity)) {
        showToast({
          message: 'Bag could not be updated',
          description: 'Refresh your bag and try changing the quantity again.',
          type: 'error',
          icon: 'error',
        })
        return
      }
      dispatch({ type: 'set-cart-quantity', productId, quantity })
      if (quantity <= 0) {
        showToast({
          message: 'Item removed from bag',
          description: `${product.name} has been removed from your shopping bag.`,
          type: 'info',
          icon: 'delete',
        })
      } else if (quantity !== cartItem.quantity) {
        showToast({
          message: 'Bag updated',
          description: `${product.name} quantity is now ${quantity}.`,
          type: 'info',
          icon: 'shopping_bag',
        })
      }
    },
    removeFromCart: (productId) => {
      const product = state.products.find((entry) => entry.id === productId)
      dispatch({ type: 'remove-from-cart', productId })
      if (product) {
        showToast({
          message: 'Item removed from bag',
          description: `${product.name} has been removed from your shopping bag.`,
          type: 'info',
          icon: 'delete',
        })
      }
    },
    placeOrder: async (address, payment) => {
      const subtotal = state.cart.reduce((sum, item) => {
        const product = state.products.find((entry) => entry.id === item.productId)
        return sum + (product?.price ?? 0) * item.quantity
      }, 0)
      const shippingFee = subtotal >= 300000 ? 0 : 15000
      const items = state.cart.map((item) => {
        const product = state.products.find((entry) => entry.id === item.productId)
        return {
          productId: item.productId,
          quantity: item.quantity,
          price: product?.price ?? 0,
        }
      })
      const createdAt = new Date().toISOString()
      const isPaid =
        address.paymentMethod === 'Paystack' && Boolean(payment?.paid && payment.reference)
      const localOrder: Order = {
        id: `order-${Date.now()}`,
        number: makeOrderNumber(state.orders),
        status: 'Processing',
        paymentStatus: isPaid ? 'Paid' : 'Pending',
        paystackReference: payment?.reference ?? undefined,
        createdAt,
        customerName: address.fullName,
        customerEmail: address.email,
        shippingCity: address.city,
        items,
        subtotal,
        shippingFee,
        total: subtotal + shippingFee,
        note: address.deliveryNote || 'We will share tracking details through email and WhatsApp.',
      }

      let committedOrder = localOrder

      if (hasSupabaseConfig) {
        const response = await createOrderRecord({
          address,
          items,
          subtotal,
          shippingFee,
          total: subtotal + shippingFee,
          paymentMethod: address.paymentMethod,
          note: localOrder.note,
        })
        if (!response) {
          throw new Error('Supabase did not confirm that the order was saved. Please contact support before retrying payment.')
        }
        committedOrder = {
          ...localOrder,
          id: response.id ?? localOrder.id,
          number: response.order_number ?? response.number ?? localOrder.number,
          status: (response.status as OrderStatus | undefined) ?? localOrder.status,
          paymentStatus:
            (response.payment_status as Order['paymentStatus'] | undefined) ??
            localOrder.paymentStatus,
          createdAt: response.created_at ?? localOrder.createdAt,
          note: response.note ?? localOrder.note,
        }
      }

      dispatch({ type: 'commit-order', order: committedOrder })
      showToast({
        message: 'Order Placed Successfully',
        description: `Order ${committedOrder.number} has been registered and is processing.`,
        type: 'gold',
        icon: 'verified',
      })
      return committedOrder.id
    },
    setAdminView: (view) => dispatch({ type: 'set-admin-view', view }),
    upsertProduct: async (product) => {
      if (hasSupabaseConfig && state.user?.role === 'admin') {
        const saved = await saveProductRecord(product)
        dispatch({ type: 'upsert-product', product: saved })
        showToast({
          message: 'Product Saved',
          description: `Successfully synchronized ${saved.name} record.`,
          type: 'success',
          icon: 'save',
        })
        if (saved.status === 'Active') {
          try {
            await sendProductAnnouncementEmail(saved.id)
          } catch (error) {
            showToast({
              message: 'In-site update saved; email not sent',
              description: error instanceof Error ? error.message : 'Unable to send product announcement emails.',
              type: 'error',
              icon: 'mark_email_unread',
            })
          }
        }
        return saved
      }

      const localProduct = formToProduct(product)
      dispatch({ type: 'upsert-product', product: localProduct })
      showToast({
        message: 'Product Saved',
        description: `Successfully saved ${localProduct.name} locally.`,
        type: 'success',
        icon: 'save',
      })
      return localProduct
    },
    deleteProduct: async (productId) => {
      if (state.user?.role !== 'admin') {
        throw new Error('Only an administrator can delete products.')
      }
      if (hasSupabaseConfig) {
        await deleteProductRecord(productId)
      }
      dispatch({ type: 'remove-product', productId })
      showToast({
        message: 'Product deleted',
        description: 'The product has been removed from the catalog.',
        type: 'success',
        icon: 'delete',
      })
    },
    updateOrderStatus: async (orderId, status) => {
      try {
        if (hasSupabaseConfig) {
          if (state.user?.role !== 'admin') {
            throw new Error('Only an administrator can update order status.')
          }
          await updateOrderStatusRecord(orderId, status)
        }
        dispatch({ type: 'update-order-status', orderId, status })
        showToast({
          message: 'Order Status Updated',
          description: `Status changed to ${status}.`,
          type: 'success',
          icon: 'update',
        })
      } catch (error) {
        showToast({
          message: 'Order status was not updated',
          description: error instanceof Error ? error.message : 'Please refresh and try again.',
          type: 'error',
          icon: 'error',
        })
      }
    },
    hideCancelledOrder: async (orderId) => {
      if (state.user?.role !== 'customer') {
        throw new Error('Only customers can hide their own cancelled orders.')
      }

      const order = state.orders.find((entry) => entry.id === orderId)
      if (!order || order.status !== 'Cancelled') {
        throw new Error('Only orders marked as cancelled can be removed from your order history.')
      }

      if (hasSupabaseConfig) {
        await hideCancelledOrderRecord(orderId)
      }
      dispatch({ type: 'hide-order', orderId })
      showToast({
        message: 'Cancelled order removed',
        description: 'The order is hidden from your history. Admins can still access the record.',
        type: 'success',
        icon: 'inventory_2',
      })
    },
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const context = useContext(StoreContext)
  if (!context) {
    throw new Error('useStore must be used inside StoreProvider')
  }

  return context
}

export function useStoreSnapshot() {
  return useStore().state
}

export function computeCartSubtotal(products: Product[], cart: CartItem[]) {
  return cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.productId)
    return sum + (product?.price ?? 0) * item.quantity
  }, 0)
}

export function getShippingFee(subtotal: number) {
  return subtotal >= 300000 ? 0 : 15000
}

export function emptyProductForm(): ProductFormState {
  return {
    name: '',
    slug: '',
    category: 'Rings',
    image: '',
    gallery: '',
    price: '',
    compareAtPrice: '',
    badge: '',
    gemstone: '',
    material: '',
    description: '',
    story: '',
    rating: '4.8',
    featured: false,
    status: 'Active',
    accent: 'linear-gradient(135deg, #120f0b 0%, #5f4b22 50%, #c8a44d 100%)',
  }
}
