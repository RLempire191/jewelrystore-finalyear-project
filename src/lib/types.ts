export type UserRole = 'guest' | 'customer' | 'admin'

export type ProductCategory = 'Rings' | 'Necklaces' | 'Bracelets' | 'Earrings' | 'Watches'
export type ProductStatus = 'Active' | 'Draft' | 'Archived'
export type OrderStatus = 'Processing' | 'Crafting' | 'Shipped' | 'Delivered' | 'Cancelled'
export type PaymentStatus = 'Pending' | 'Paid' | 'Refunded'

export interface Product {
  id: string
  slug: string
  name: string
  category: ProductCategory
  image: string
  gallery?: string[]
  price: number
  compareAtPrice?: number
  badge?: string
  gemstone: string
  material: string
  description: string
  story: string
  rating: number
  featured: boolean
  status: ProductStatus
  accent: string
}

export interface CartItem {
  productId: string
  quantity: number
}

export interface OrderItem {
  productId: string
  quantity: number
  price: number
}

export interface Address {
  fullName: string
  email: string
  phone: string
  city: string
  state: string
  country: string
  street: string
}

export interface SavedAddress {
  id: string
  label: string
  fullName: string
  phone: string
  city: string
  state: string
  country: string
  street: string
  isDefault: boolean
}

export interface InboxNotification {
  id: string
  type: 'product' | 'support'
  title: string
  message: string
  href: string
  conversationId?: string | null
  readAt: string | null
  createdAt: string
}

export interface SupportConversation {
  id: string
  userId: string
  customerName: string
  customerEmail: string
  updatedAt: string
}

export interface SupportMessage {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
  readAt: string | null
}

export interface Order {
  id: string
  number: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paystackReference?: string
  createdAt: string
  customerName: string
  customerEmail: string
  shippingCity: string
  items: OrderItem[]
  subtotal: number
  shippingFee: number
  total: number
  note: string
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: UserRole
  city: string
  state?: string
  phone?: string
  marketingEmailOptIn: boolean
}

export interface StoreState {
  user: SessionUser | null
  products: Product[]
  cart: CartItem[]
  wishlist: string[]
  orders: Order[]
  lastOrderId: string | null
  adminView: 'dashboard' | 'products' | 'orders'
}

export interface ProductFormState {
  id?: string
  name: string
  slug: string
  category: ProductCategory
  image: string
  gallery: string
  price: string
  compareAtPrice: string
  badge: string
  gemstone: string
  material: string
  description: string
  story: string
  rating: string
  featured: boolean
  status: ProductStatus
  accent: string
}

export interface CheckoutFormState extends Address {
  deliveryNote: string
  paymentMethod: 'Transfer' | 'Paystack' | 'Pay on delivery'
  newsletter: boolean
}

export interface CheckoutPaymentMeta {
  reference?: string | null
  paid?: boolean
}

export interface Toast {
  id: string
  message: string
  description?: string
  type: 'success' | 'info' | 'warning' | 'error' | 'gold'
  duration?: number
  action?: {
    label: string;
    onClick: () => void;
  }
  icon?: string
}

export type ToastPosition = 'top' | 'bottom'
