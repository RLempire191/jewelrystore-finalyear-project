import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { ToastContainer } from './components/ToastContainer'
import {
  formatDate,
  formatDateTime,
  formatNaira,
  initials,
  slugify,
}
 from './lib/format'
import { heroImages, productImageFallback } from './lib/images'
import {
  deleteUserAddress,
  fetchInboxNotifications,
  fetchSupportConversations,
  fetchSupportMessages,
  fetchUserAddresses,
  getOrCreateSupportConversation,
  hasSupabaseConfig,
  markInboxNotificationRead,
  markSupportMessagesRead,
  saveUserAddress,
  sendSupportMessage,
  sendSupportMessageEmail,
  signOutFromSupabase,
} from './lib/supabase'
import { getNigeriaStateForCity, nigeriaCitiesByState, nigeriaStates } from './lib/mockData'
import {
  computeCartSubtotal,
  emptyProductForm,
  getShippingFee,
  StoreProvider,
  useStore,
} from './lib/store'
import { ThemeProvider, useTheme } from './lib/theme'
import {
  canStartPaystack,
  createPaystackReference,
  hasPaystackConfig,
  initiatePaystackPayment,
  preloadPaystackCheckout,
  simulatePaystackPayment,
} from './lib/paystack'
import type {
  CheckoutFormState,
  InboxNotification,
  Order,
  OrderStatus,
  Product,
  ProductFormState,
  SavedAddress,
  SessionUser,
  SupportConversation,
  SupportMessage,
  UserRole,
} from './lib/types'

type RouteKind =
  | 'home'
  | 'collections'
  | 'our-story'
  | 'bridal'
  | 'high-jewelry'
  | 'shop'
  | 'product'
  | 'bag'
  | 'checkout'
  | 'confirmation'
  | 'auth-confirmed'
  | 'login'
  | 'register'
  | 'auth'
  | 'account'
  | 'admin-inbox'
  | 'admin-dashboard'
  | 'admin-products'
  | 'admin-orders'
  | 'not-found'

const otherCityValue = '__other__'

function isNigeriaStateName(value: string): boolean {
  const normalizedValue = value.trim().toLocaleLowerCase().replace(/\s+state$/, '')
  return nigeriaStates.some((state) => state.toLocaleLowerCase() === normalizedValue)
}

function citySelectValue(state: string, city: string): string {
  if (!city) return ''
  const matchingCity = (nigeriaCitiesByState[state] ?? []).find(
    (knownCity) => knownCity.toLocaleLowerCase() === city.trim().toLocaleLowerCase(),
  )
  if (matchingCity) return matchingCity
  return isNigeriaStateName(city) ? '' : otherCityValue
}

function isStateStoredAsCity(city: string, state: string): boolean {
  return isNigeriaStateName(city) && !citySelectValue(state, city)
}

function formatAddressCityState(city: string, state: string): string {
  return isStateStoredAsCity(city, state) || !city.trim() ? `City needed · ${state}` : `${city}, ${state}`
}

interface RouteInfo {
  kind: RouteKind
  slug?: string
  query: URLSearchParams
}

const imagery = heroImages

function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <RouterShell />
      </StoreProvider>
    </ThemeProvider>
  )
}

function RouterShell() {
  const { state, authReady, signOut } = useStore()
  const route = useRouteInfo()
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null)
  const [showWelcome, setShowWelcome] = useState(true)
  const isAdminRoute = route.kind.startsWith('admin')
  const isAdminUser = state.user?.role === 'admin'

  useEffect(() => {
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 900 : 2600
    const timeout = window.setTimeout(() => setShowWelcome(false), duration)
    return () => window.clearTimeout(timeout)
  }, [])

  let content
  if (route.kind === 'auth-confirmed') {
    content = <EmailConfirmationPage authReady={authReady} user={state.user} signOut={signOut} />
  } else if (isAdminRoute && !isAdminUser) {
    content = <AccessDenied />
  } else if (isAdminRoute) {
    content = <AdminLayout route={route} />
  } else if (route.kind === 'account' && isAdminUser) {
    content = <AdminLayout route={{ ...route, kind: 'admin-dashboard' }} />
  } else {
    content = (
      <PublicLayout
        route={route}
        quickViewProduct={quickViewProduct}
        setQuickViewProduct={setQuickViewProduct}
      />
    )
  }

  return (
    <>
      <div inert={showWelcome}>
        {content}
        <ToastContainer />
      </div>
      {showWelcome && <WelcomeSplash onEnter={() => setShowWelcome(false)} />}
    </>
  )
}

function WelcomeSplash({ onEnter }: { onEnter: () => void }) {
  const enterButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    enterButton.current?.focus()
  }, [])

  return (
    <div className="welcome-splash" role="dialog" aria-modal="true" aria-labelledby="welcome-splash-title">
      <div className="welcome-splash__image" style={{ backgroundImage: `url("${imagery.jewelryHero}")` }} />
      <div className="welcome-splash__veil" />
      <div className="welcome-splash__content">
        <span className="welcome-splash__gem" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M5 11.5 10 5h12l5 6.5L16 27 5 11.5Z" />
            <path d="M5 11.5h22M10 5l3 6.5 3 15 3-15L22 5" />
          </svg>
        </span>
        <p className="welcome-splash__eyebrow">THE LUMINA ATELIER</p>
        <h1 id="welcome-splash-title">Jewelry with a story.</h1>
        <p className="welcome-splash__tagline">A little light, made personal.</p>
        <span className="welcome-splash__progress" aria-hidden="true"><span /></span>
        <button ref={enterButton} type="button" className="welcome-splash__enter" onClick={onEnter}>
          Enter the atelier <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  )
}

function EmailConfirmationPage({
  authReady,
  user,
  signOut,
}: {
  authReady: boolean
  user: SessionUser | null
  signOut: () => Promise<void>
}) {
  const route = useRouteInfo()
  const [error, setError] = useState<string | null>(() => {
    const description = route.query.get('error_description')
    return description
  })
  const completionStarted = useRef(false)

  useEffect(() => {
    if (!authReady || error || completionStarted.current) {
      return
    }

    const timeout = window.setTimeout(() => {
      completionStarted.current = true
      void (async () => {
        try {
          if (user) {
            await signOut()
          } else {
            await signOutFromSupabase()
          }
          navigate('/login?confirmed=1')
        } catch (confirmationError) {
          completionStarted.current = false
          setError(
            confirmationError instanceof Error
              ? confirmationError.message
              : 'We could not finish confirming your email. Please try the link again.',
          )
        }
      })()
    }, 1100)

    return () => window.clearTimeout(timeout)
  }, [authReady, error, signOut, user])

  return (
    <main className="email-confirmation">
      <div className="email-confirmation__card">
        <span className={`email-confirmation__icon ${error ? 'has-error' : ''}`} aria-hidden="true">
          <span className="material-symbols-outlined">{error ? 'error' : 'mark_email_read'}</span>
        </span>
        <p className="eyebrow">LUMINA ATELIER</p>
        <h1>{error ? 'Confirmation link needs attention' : 'Confirming your email'}</h1>
        <p aria-live="polite">
          {error
            ? error
            : 'Your email is verified. We’re preparing your sign-in so you can continue securely.'}
        </p>
        {error ? (
          <LinkButton href="/login" className="button-primary">Continue to sign in</LinkButton>
        ) : (
          <span className="email-confirmation__loader" role="status" aria-label="Loading" />
        )}
      </div>
    </main>
  )
}

function useRouteInfo(): RouteInfo {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }))

  useEffect(() => {
    const onPopState = () => {
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      })
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return {
    kind: resolveRoute(location.pathname),
    slug: location.pathname.startsWith('/product/')
      ? location.pathname.replace('/product/', '')
      : undefined,
    query: new URLSearchParams(location.search),
  }
}

function resolveRoute(pathname: string): RouteKind {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname === '/collections') return 'collections'
  if (pathname === '/our-story') return 'our-story'
  if (pathname === '/bridal') return 'bridal'
  if (pathname === '/high-jewelry') return 'high-jewelry'
  if (pathname === '/shop') return 'shop'
  if (pathname === '/bag') return 'bag'
  if (pathname === '/checkout') return 'checkout'
  if (pathname === '/order-confirmed') return 'confirmation'
  if (pathname === '/auth/confirmed') return 'auth-confirmed'
  if (pathname === '/login') return 'login'
  if (pathname === '/register') return 'register'
  if (pathname === '/auth') return 'login'
  if (pathname === '/account') return 'account'
  if (pathname === '/admin') return 'admin-dashboard'
  if (pathname === '/admin/inbox') return 'admin-inbox'
  if (pathname === '/admin/products') return 'admin-products'
  if (pathname === '/admin/orders') return 'admin-orders'
  if (pathname.startsWith('/product/')) return 'product'
  return 'not-found'
}

function navigate(pathname: string) {
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function LinkButton({
  href,
  children,
  className = '',
  active = false,
  onClick,
  'aria-label': ariaLabel,
  title,
}: {
  href: string
  children: ReactNode
  className?: string
  active?: boolean
  onClick?: () => void
  'aria-label'?: string
  title?: string
}) {
  return (
    <a
      className={`${className} ${active ? 'is-active' : ''}`}
      href={href}
      aria-label={ariaLabel}
      title={title}
      onClick={(event) => {
        event.preventDefault()
        navigate(href)
        onClick?.()
      }}
    >
      {children}
    </a>
  )
}

function PublicLayout({
  route,
  quickViewProduct,
  setQuickViewProduct,
}: {
  route: RouteInfo
  quickViewProduct: Product | null
  setQuickViewProduct: (product: Product | null) => void
}) {
  const { state } = useStore()
  const cartCount = state.cart.reduce((sum, item) => sum + item.quantity, 0)
  const wishlistCount = state.products.filter((product) => state.wishlist.includes(product.id)).length
  const currentProduct =
    route.kind === 'product'
      ? state.products.find((product) => product.slug === route.slug)
      : undefined

  return (
    <div className="app-shell">
      <SiteHeader cartCount={cartCount} wishlistCount={wishlistCount} />
      <main className="page-shell">
        {route.kind === 'home' && (
          <HomePage onQuickView={setQuickViewProduct} />
        )}
        {route.kind === 'collections' && (
          <CollectionsPage onQuickView={setQuickViewProduct} />
        )}
        {route.kind === 'our-story' && <OurStoryPage />}
        {route.kind === 'bridal' && (
          <BridalPage onQuickView={setQuickViewProduct} />
        )}
        {route.kind === 'high-jewelry' && (
          <HighJewelryPage onQuickView={setQuickViewProduct} />
        )}
        {route.kind === 'shop' && (
          <ShopPage onQuickView={setQuickViewProduct} />
        )}
        {route.kind === 'product' && currentProduct && (
          <ProductPage product={currentProduct} onQuickView={setQuickViewProduct} />
        )}
        {route.kind === 'product' && !currentProduct && <NotFoundPage />}
        {route.kind === 'bag' && <BagPage />}
        {route.kind === 'checkout' && <CheckoutPage />}
        {route.kind === 'confirmation' && <ConfirmationPage orderId={route.query.get('order')} />}
        {route.kind === 'login' && <LoginPage />}
        {route.kind === 'register' && <RegisterPage />}
        {route.kind === 'account' && <AccountPage />}
        {route.kind === 'not-found' && <NotFoundPage />}
      </main>
      <SiteFooter />
      <SupportChatWidget />
      {state.user?.role !== 'admin' && (
        <MobileBottomNav cartCount={cartCount} wishlistCount={wishlistCount} />
      )}
      {quickViewProduct && (
        <QuickViewModal
          key={quickViewProduct.id}
          product={quickViewProduct}
          onClose={() => setQuickViewProduct(null)}
        />
      )}
    </div>
  )
}

function SiteHeader({ cartCount, wishlistCount }: { cartCount: number; wishlistCount: number }) {
  const { state, signOut } = useStore()
  const { theme, toggleTheme } = useTheme()
  const isAdmin = state.user?.role === 'admin'
  const pathname = window.location.pathname
  const [menuOpen, setMenuOpen] = useState(false)
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false)

  async function confirmSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <>
    <header className="site-header">
      <div className="header-inner">
        <LinkButton href="/" className="brand-lockup" aria-label="Lumina Jewelry home">
          <span className="brand-lockup__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M5 11.5 10 5h12l5 6.5L16 27 5 11.5Z" />
              <path d="M5 11.5h22M10 5l3 6.5 3 15 3-15L22 5" />
            </svg>
          </span>
          <span className="brand-lockup__copy">
            <span className="brand-mark">LUMINA</span>
            <span className="brand-copy">Jewelry Atelier</span>
          </span>
        </LinkButton>

        <div className="header-main">
          <nav className="site-nav" aria-label="Main navigation">
            <LinkButton href="/" active={pathname === '/'}>
              Home
            </LinkButton>
            <LinkButton href="/shop" active={pathname === '/shop' || pathname.startsWith('/product/')}>
              Shop
            </LinkButton>
            <LinkButton href="/our-story" active={pathname === '/our-story'}>
              About
            </LinkButton>
            {!isAdmin && (
              <LinkButton href="/account#wishlist" active={pathname === '/account'}>
                Wishlist
              </LinkButton>
            )}
            {isAdmin && (
              <LinkButton href="/admin" active={pathname.startsWith('/admin')}>
                Admin
              </LinkButton>
            )}
          </nav>

          {menuOpen && (
            <nav className="mobile-nav-menu" aria-label="Mobile navigation">
              <LinkButton href="/" active={pathname === '/'} onClick={() => setMenuOpen(false)}>
                Home
              </LinkButton>
              <LinkButton href="/shop" active={pathname === '/shop'} onClick={() => setMenuOpen(false)}>
                Shop
              </LinkButton>
              <LinkButton href="/our-story" active={pathname === '/our-story'} onClick={() => setMenuOpen(false)}>
                About
              </LinkButton>
              {!isAdmin && (
                <LinkButton href="/account#wishlist" active={pathname === '/account'} onClick={() => setMenuOpen(false)}>
                  Wishlist
                </LinkButton>
              )}
              <LinkButton
                href={state.user ? (isAdmin ? '/admin' : '/account') : '/login'}
                active={pathname === '/account' || pathname === '/admin' || pathname === '/login'}
                onClick={() => setMenuOpen(false)}
              >
                {state.user ? (isAdmin ? 'Admin dashboard' : 'My account') : 'Sign in'}
              </LinkButton>
              {state.user && (
                <button
                  type="button"
                  className="mobile-nav-menu__action"
                  onClick={() => {
                    setMenuOpen(false)
                    setShowSignOutConfirmation(true)
                  }}
                >
                  <HeaderIcon name="sign-out" />
                  Sign out
                </button>
              )}
              {isAdmin && (
                <LinkButton href="/admin" active={pathname.startsWith('/admin')} onClick={() => setMenuOpen(false)}>
                  Admin
                </LinkButton>
              )}
            </nav>
          )}

          <div className="header-actions">
            <button
              type="button"
              className="icon-button mobile-menu-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="material-symbols-outlined">{menuOpen ? 'close' : 'menu'}</span>
            </button>
            {!state.user && (
              <>
                <LinkButton href="/login" className="header-sign-in">
                  Sign in
                </LinkButton>
                <LinkButton href="/register" className="button-primary button-primary--small header-join">
                  Join
                </LinkButton>
              </>
            )}
            {state.user && (
              <>
                <span className="header-user">
                  Welcome, <strong>{state.user.name.split(' ')[0]}</strong>
                </span>
                <LinkButton
                  href={isAdmin ? '/admin' : '/account'}
                  className="icon-button header-account-link"
                  aria-label={isAdmin ? 'Admin dashboard' : 'My account'}
                  title={isAdmin ? 'Admin dashboard' : 'My account'}
                  active={isAdmin ? pathname.startsWith('/admin') : pathname === '/account'}
                >
                  <span className="material-symbols-outlined">person</span>
                </LinkButton>
                <button
                  type="button"
                  className="icon-button header-sign-out"
                  aria-label="Sign out"
                  title="Sign out"
                  onClick={() => setShowSignOutConfirmation(true)}
                >
                  <HeaderIcon name="sign-out" />
                </button>
              </>
            )}
            {!isAdmin && (
              <LinkButton
                href="/account#wishlist"
                className="icon-button header-wishlist-link"
                aria-label={wishlistCount === 1 ? 'Wishlist, 1 saved piece' : `Wishlist, ${wishlistCount} saved pieces`}
                title={wishlistCount === 1 ? 'Wishlist, 1 saved piece' : `Wishlist, ${wishlistCount} saved pieces`}
                active={pathname === '/account'}
              >
                <HeaderIcon name="wishlist" />
                {wishlistCount > 0 && <span className="wishlist-count">{wishlistCount}</span>}
              </LinkButton>
            )}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {!isAdmin && (
              <>
                <button
                  type="button"
                  className="icon-button header-search-button"
                  aria-label="Search products"
                  onClick={() => navigate('/shop')}
                >
                  <span className="material-symbols-outlined">search</span>
                </button>
                <LinkButton
                  href="/bag"
                  className="icon-button icon-button--bag"
                  aria-label={cartCount === 1 ? 'Shopping bag, 1 item' : `Shopping bag, ${cartCount} items`}
                  title={cartCount === 1 ? 'Shopping bag, 1 item' : `Shopping bag, ${cartCount} items`}
                >
                  <HeaderIcon name="cart" />
                  <span className="bag-count">{cartCount}</span>
                </LinkButton>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
    {showSignOutConfirmation && (
      <SignOutConfirmation
        onCancel={() => setShowSignOutConfirmation(false)}
        onConfirm={confirmSignOut}
      />
    )}
    </>
  )
}

function HeaderIcon({ name }: { name: 'wishlist' | 'cart' | 'sign-out' }) {
  if (name === 'wishlist') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6l1.2 1.2L12 21l7.6-7.6 1.2-1.2a5.4 5.4 0 0 0 0-7.6Z" />
      </svg>
    )
  }

  if (name === 'cart') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M3 4h2l2.2 11a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.5L21 8H6" />
        <circle cx="9.5" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
    </svg>
  )
}

function SignOutConfirmation({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSigningOut) {
        onCancel()
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [isSigningOut, onCancel])

  async function submitSignOut() {
    setError(null)
    setIsSigningOut(true)

    try {
      await onConfirm()
      onCancel()
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Unable to sign out. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return createPortal(
    <div
      className="modal-backdrop sign-out-backdrop"
      role="presentation"
      onClick={() => {
        if (!isSigningOut) onCancel()
      }}
    >
      <section
        className="sign-out-dialog glass-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sign-out-title"
        aria-describedby="sign-out-description"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sign-out-dialog__icon" aria-hidden="true">
          <HeaderIcon name="sign-out" />
        </span>
        <p className="eyebrow">Lumina Atelier</p>
        <h2 id="sign-out-title">Sign out of your account?</h2>
        <p id="sign-out-description">You can sign in again any time to see your account and saved pieces.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="sign-out-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="button-ghost"
            onClick={onCancel}
            disabled={isSigningOut}
          >
            Stay signed in
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => void submitSignOut()}
            disabled={isSigningOut}
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: 'dark' | 'light'
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={onToggle}
    >
      <span className="material-symbols-outlined">
        {theme === 'dark' ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  )
}

function MobileBottomNav({ cartCount, wishlistCount }: { cartCount: number; wishlistCount: number }) {
  const pathname = window.location.pathname

  return (
    <nav className="mobile-bottom-nav" aria-label="Quick navigation">
      <LinkButton href="/" active={pathname === '/'} className="mobile-bottom-nav__item">
        <span className="material-symbols-outlined">home</span>
        <span>Home</span>
      </LinkButton>
      <LinkButton href="/shop" active={pathname === '/shop' || pathname.startsWith('/product/')} className="mobile-bottom-nav__item">
        <span className="material-symbols-outlined">grid_view</span>
        <span>Shop</span>
      </LinkButton>
      <LinkButton href="/account#wishlist" active={pathname === '/account'} className="mobile-bottom-nav__item">
        <span className="mobile-bottom-nav__icon">
          <span className="material-symbols-outlined">favorite</span>
          {wishlistCount > 0 && <span className="bag-badge">{wishlistCount}</span>}
        </span>
        <span>Wishlist</span>
      </LinkButton>
      <LinkButton href="/bag" active={pathname === '/bag'} className="mobile-bottom-nav__item mobile-bottom-nav__item--bag">
        <div className="bag-icon-wrapper">
        <span className="material-symbols-outlined">shopping_bag</span>
          {cartCount > 0 && <span className="bag-badge">{cartCount}</span>}
        </div>
        <span>Bag</span>
      </LinkButton>
    </nav>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-shell">
        <div className="footer-grid">
          <div className="footer-block footer-brand">
            <LinkButton href="/" className="footer-brand__lockup">
              <span className="brand-lockup__mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none">
                  <path d="M5 11.5 10 5h12l5 6.5L16 27 5 11.5Z" />
                  <path d="M5 11.5h22M10 5l3 6.5 3 15 3-15L22 5" />
                </svg>
              </span>
              <span className="brand-lockup__copy">
                <span className="brand-mark">LUMINA</span>
                <span className="brand-copy">Jewelry Atelier</span>
              </span>
            </LinkButton>
            <p>Considered design. Lasting pieces. A little more personal.</p>
            <p className="footer-note">Lagos, Nigeria</p>
          </div>
          <div className="footer-block">
            <h4>Discover</h4>
            <LinkButton href="/">Home</LinkButton>
            <LinkButton href="/shop">Shop</LinkButton>
            <LinkButton href="/our-story">About Lumina</LinkButton>
            <LinkButton href="/account#wishlist">Wishlist</LinkButton>
          </div>
          <div className="footer-block">
            <h4>Client care</h4>
            <p className="footer-note">We are here to help with your order, a special request, or choosing the right piece.</p>
            <a href="mailto:abideenqudusolarenwaju@gmail.com">Email our team</a>
            <a href="tel:+2349117669597">Call 0911 766 9597</a>
            <p className="footer-note">Mon–Sat · 9:00am–6:00pm</p>
          </div>
          <div className="footer-block">
            <h4>Follow along</h4>
            <p className="footer-note">Discover new arrivals, styling notes, and moments from the atelier.</p>
            <div className="social-links">
              <a className="social-link" href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Follow Lumina Jewelry on Facebook" title="Facebook">
                <svg viewBox="0 0 320 512" aria-hidden="true">
                  <path d="M279.14 288l14.22-92.66h-88.27V120.6c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.11 44.38-121.11 124.72v70.62H22.89V288h81.36v224h100.2V288z" fill="currentColor" />
                </svg>
                <span>Facebook</span>
              </a>
              <a className="social-link" href="https://wa.me/2349117669597?text=Hello%20Lumina%20Jewelry" target="_blank" rel="noreferrer" aria-label="Chat with Lumina Jewelry on WhatsApp" title="WhatsApp">
                <svg viewBox="0 0 32 32" aria-hidden="true">
                  <path d="M16.04 4C9.43 4 4.05 9.34 4.05 15.9c0 2.1.56 4.15 1.62 5.95L4 28l6.35-1.62a12.15 12.15 0 0 0 5.69 1.42C22.65 27.8 28 22.46 28 15.9S22.65 4 16.04 4Zm0 21.72c-1.83 0-3.61-.49-5.18-1.43l-.37-.22-3.76.96 1-3.64-.24-.38a9.77 9.77 0 0 1-1.5-5.11c0-5.42 4.51-9.83 10.05-9.83 5.53 0 10.04 4.41 10.04 9.83 0 5.42-4.51 9.82-10.04 9.82Zm5.5-7.35c-.3-.15-1.78-.87-2.06-.97-.28-.1-.48-.15-.68.15-.2.29-.78.96-.95 1.16-.18.19-.35.22-.65.07-.3-.15-1.27-.46-2.42-1.48-.9-.78-1.5-1.75-1.67-2.04-.18-.3-.02-.45.13-.6.14-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.68-1.62-.93-2.22-.24-.58-.5-.5-.68-.51h-.58c-.2 0-.53.07-.8.37-.28.3-1.06 1.02-1.06 2.49 0 1.47 1.08 2.9 1.23 3.1.15.2 2.13 3.23 5.16 4.52.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.78-.72 2.03-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z" fill="currentColor" />
                </svg>
                <span>WhatsApp</span>
              </a>
              <a className="social-link" href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Follow Lumina Jewelry on Instagram" title="Instagram">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.2 3h9.6A4.2 4.2 0 0 1 21 7.2v9.6A4.2 4.2 0 0 1 16.8 21H7.2A4.2 4.2 0 0 1 3 16.8V7.2A4.2 4.2 0 0 1 7.2 3Zm0 1.8A2.4 2.4 0 0 0 4.8 7.2v9.6a2.4 2.4 0 0 0 2.4 2.4h9.6a2.4 2.4 0 0 0 2.4-2.4V7.2a2.4 2.4 0 0 0-2.4-2.4H7.2Zm9.8 2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM12 7.8A4.2 4.2 0 1 1 7.8 12 4.2 4.2 0 0 1 12 7.8Zm0 1.8A2.4 2.4 0 1 0 14.4 12 2.4 2.4 0 0 0 12 9.6Z" fill="currentColor" />
                </svg>
                <span>Instagram</span>
              </a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Lumina Jewelry. All rights reserved.</span>
          <span className="footer-bottom__tagline">Made with care in Nigeria</span>
        </div>
      </div>
    </footer>
  )
}

function SupportChatWidget() {
  const { state } = useStore()
  const user = state.user
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className={`support-widget${isOpen ? ' is-open' : ''}`}>
      {isOpen && (
        <section className="support-widget__panel" aria-label="Lumina customer support">
          <header className="support-widget__header">
            <span className="support-widget__avatar material-symbols-outlined" aria-hidden="true">diamond</span>
            <span>
              <strong>{user?.role === 'admin' ? 'Admin support inbox' : 'Lumina client care'}</strong>
              <small>We’re here to help with your order or a special request.</small>
            </span>
            <button
              type="button"
              className="support-widget__close"
              onClick={() => setIsOpen(false)}
              aria-label="Close support chat"
            >
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </header>
          {user?.role === 'admin' ? (
            <div className="support-widget__guest">
              <p>Review customer questions and reply from your admin mailbox.</p>
              <LinkButton href="/admin/inbox" className="button-primary">Open admin inbox</LinkButton>
            </div>
          ) : user ? (
            <SupportThread user={user} compact />
          ) : (
            <div className="support-widget__guest">
              <p>Sign in to start a private conversation and keep replies in your Lumina inbox.</p>
              <div className="support-widget__guest-actions">
                <LinkButton href="/login?redirect=%2Faccount%23inbox" className="button-primary">Sign in to chat</LinkButton>
                <LinkButton href="/register?redirect=%2Faccount%23inbox" className="button-ghost">Create account</LinkButton>
              </div>
              <a href="mailto:abideenqudusolarenwaju@gmail.com">Email client care instead</a>
            </div>
          )}
        </section>
      )}
      <button
        type="button"
        className="support-widget__launcher"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? 'Close customer support chat' : 'Open customer support chat'}
        aria-expanded={isOpen}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {isOpen ? 'close' : 'chat'}
        </span>
      </button>
    </div>
  )
}

function HomePage({
  onQuickView,
}: {
  onQuickView: (product: Product) => void
}) {
  const { state, addToCart, toggleWishlist } = useStore()
  const featured = state.products
    .filter((product) => product.status === 'Active' && product.featured)
    .slice(0, 4)
  const heroProduct = state.products.find(
    (product) => product.status === 'Active' && product.slug === 'the-aurora-ring',
  ) ?? featured[0]
  const categories: Array<{ name: Product['category']; description: string }> = [
    {
      name: 'Rings',
      description: 'A signature for every day.',
    },
    {
      name: 'Necklaces',
      description: 'Layers with a little meaning.',
    },
    {
      name: 'Earrings',
      description: 'The finishing touch, reimagined.',
    },
    {
      name: 'Bracelets',
      description: 'Small details that stay with you.',
    },
  ]

  return (
    <div className="page-stack home-page">
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">Jewellery for the moments that become yours</p>
          <h1>Keep a little meaning close.</h1>
          <p>
            Discover considered pieces for everyday rituals, thoughtful gifts, and the
            occasions you will remember. Find your next favourite at Lumina.
          </p>
          <div className="hero-actions">
            <LinkButton href="/shop" className="button-primary">Explore the collection</LinkButton>
            <LinkButton href="/our-story" className="button-ghost">Get to know Lumina</LinkButton>
          </div>
          <span className="home-hero__location">A Lagos-based jewelry destination</span>
        </div>
        {heroProduct && (
          <div className="home-hero__visual">
            <button
              type="button"
              className="home-hero__image-button"
              onClick={() => onQuickView(heroProduct)}
              aria-label={`View ${heroProduct.name}`}
            >
              <SafeImage
                src={heroProduct.image || imagery.jewelryHero}
                alt={heroProduct.name}
                className="home-hero__image"
              />
            </button>
            <LinkButton href={`/product/${heroProduct.slug}`} className="home-hero__product">
              <span>
                <span className="eyebrow">The Lumina edit</span>
                <strong>{heroProduct.name}</strong>
              </span>
              <span className="home-hero__product-price">{formatNaira(heroProduct.price)}</span>
              <span className="material-symbols-outlined" aria-hidden="true">arrow_outward</span>
            </LinkButton>
          </div>
        )}
      </section>

      <section className="home-service-strip" aria-label="Shopping with Lumina">
        <article>
          <span className="material-symbols-outlined" aria-hidden="true">diamond</span>
          <div><strong>Pieces with presence</strong><span>Explore gold, pearls, and considered details.</span></div>
        </article>
        <article>
          <span className="material-symbols-outlined" aria-hidden="true">local_shipping</span>
          <div><strong>Complimentary delivery</strong><span>On orders of NGN 300,000 and above.</span></div>
        </article>
        <article>
          <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
          <div><strong>Here to help</strong><span>Our Lagos team is ready to assist.</span></div>
        </article>
      </section>

      <section className="home-categories">
        <SectionHeading
          eyebrow="Find your kind of shine"
          title="A piece for every way of being you."
          text="Start with a favourite, or follow the detail that catches your eye."
        />
        <div className="home-category-grid">
          {categories.map((category) => {
            const product = state.products.find(
              (item) => item.category === category.name && item.status === 'Active',
            )
            return (
              <LinkButton
                key={category.name}
                href={`/shop?category=${encodeURIComponent(category.name)}`}
                className="home-category-card"
              >
                {product && <SafeImage src={product.image} alt="" />}
                <span className="home-category-card__overlay" />
                <span className="home-category-card__copy">
                  <span>{category.description}</span>
                  <strong>{category.name}</strong>
                  <span className="home-category-card__link">Explore <span aria-hidden="true">↗</span></span>
                </span>
              </LinkButton>
            )
          })}
        </div>
      </section>

      <section className="content-section home-featured">
        <SectionHeading
          eyebrow="Selected for you"
          title="A closer look at Lumina favourites."
          text="A closer look at Lumina favourites, chosen for their thoughtful details and easy-to-love silhouettes."
        />
        <div className="product-grid product-grid--shop">
          {featured.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onQuickAdd={() => addToCart(product.id)}
              onWishlist={() => toggleWishlist(product.id)}
              onQuickView={() => onQuickView(product)}
            />
          ))}
        </div>
        <LinkButton href="/shop" className="button-ghost home-featured__link">View all pieces</LinkButton>
      </section>

      <section className="home-story">
        <div className="home-story__visual">
          <SafeImage src={heroImages.ourStoryHero} alt="An intimate detail from the Lumina jewelry collection" />
        </div>
        <div className="home-story__copy">
          <p className="eyebrow">A little about us</p>
          <h2>Good jewelry should feel like it already belongs to you.</h2>
          <p>
            Lumina brings together expressive designs, thoughtful gifting, and a welcoming
            shopping experience rooted in Lagos. Explore at your own pace, and choose the
            pieces that make a moment feel like yours.
          </p>
          <LinkButton href="/our-story" className="button-ghost">Discover our approach</LinkButton>
        </div>
      </section>
    </div>
  )
}

function CollectionsPage({
  onQuickView,
}: {
  onQuickView: (product: Product) => void
}) {
  const { state } = useStore()
  const featured = state.products.filter((product) => product.featured)

  return (
    <div className="page-stack">
      <section className="editorial-hero glass-card">
        <div className="editorial-hero__copy">
          <p className="eyebrow">Collections</p>
          <h1>The Masterpiece Collections</h1>
          <p>
            A curated gallery presenting our most exclusive design languages. Discover sculptural silhouettes,
            cinematic visuals, and meticulously cataloged masterpieces.
          </p>
        </div>
        <div className="editorial-hero__panel">
          <span>12 Collections</span>
          <strong>Signature, Aurora, Heritage</strong>
          <p>Luxury navigation for serious shoppers and concierge-style browsing.</p>
        </div>
      </section>

      <section className="editorial-focus">
        <article className="editorial-feature glass-card">
          <img
            className="editorial-feature__image"
            src={heroImages.signatureBox}
            alt="Lumina jewelry collections editorial screen"
          />
          <div>
            <p className="eyebrow">Signature</p>
            <h2>Aurelia Band</h2>
            <p>Gold, diamond, and rare silhouettes anchored in the brand’s core language.</p>
          </div>
        </article>
        <article className="editorial-feature glass-card">
          <img
            className="editorial-feature__image"
            src={heroImages.auroraBox}
            alt="Lumina jewelry story editorial screen"
          />
          <div>
            <p className="eyebrow">Aurora</p>
            <h2>Light in the void</h2>
            <p>An avant-garde exploration of luminescence, contrast, and structural symmetry.</p>
          </div>
        </article>
      </section>

      <section className="content-section">
        <SectionHeading
          eyebrow="Curated Collection"
          title="The House Portfolio"
          text="Explore our timeless silhouettes, curated for collectors who appreciate bespoke craftsmanship."
        />
        <div className="product-grid product-grid--shop">
          {featured.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onQuickAdd={() => navigate(`/product/${product.slug}`)}
              onWishlist={() => undefined}
              onQuickView={() => onQuickView(product)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function OurStoryPage() {
  return (
    <div className="page-stack about-page">
      <section className="story-hero about-hero">
        <div className="story-hero__headline">
          <p className="eyebrow">A little more about us</p>
          <h1>Jewelry for the stories you live.</h1>
          <p>
            Lumina is a Lagos-based jewelry house for pieces chosen with intention.
            We bring together considered design, personal service, and the small details
            that make a piece feel unmistakably yours.
          </p>
          <div className="about-hero__actions">
            <LinkButton href="/shop" className="button-primary">Explore the collection</LinkButton>
            <span>Thoughtfully chosen. Made to be treasured.</span>
          </div>
        </div>
        <div className="about-hero__visual">
          <SafeImage src={heroImages.ourStoryHero} alt="A close-up of jewelry with warm, considered details" />
          <span><small>THE LUMINA POINT OF VIEW</small>Made for your moments, near and far.</span>
        </div>
      </section>

      <section className="about-intro">
        <p className="eyebrow">More than an occasion</p>
        <h2>The pieces you reach for become part of your story.</h2>
        <p>
          A first celebration, a thoughtful gift, or simply a detail that feels like you.
          We believe fine jewelry belongs in the moments that matter—and in all the
          ordinary days in between.
        </p>
      </section>

      <section className="about-story">
        <div className="about-story__copy">
          <p className="eyebrow">A more personal way to choose</p>
          <h2>Good design. A little meaning. A lot of you.</h2>
          <p>
            Finding the right piece should feel easy, never overwhelming. Our edit brings
            together expressive silhouettes and everyday favourites, with room to discover
            your own style at your own pace.
          </p>
          <LinkButton href="/shop" className="button-ghost">Find your favourite <span aria-hidden="true">↗</span></LinkButton>
        </div>
        <div className="about-story__note">
          <span>THE LUMINA PROMISE</span>
          <strong>Considered at every step.</strong>
          <p>From browsing to gifting, thoughtful service is part of every Lumina experience.</p>
          <div><span>01</span> A considered collection</div>
          <div><span>02</span> Personal guidance when you need it</div>
          <div><span>03</span> Care that continues after checkout</div>
        </div>
      </section>

      <div className="about-values-heading">
        <p className="eyebrow">What matters to us</p>
        <h2>A thoughtful experience, from first look to forever.</h2>
      </div>
      <section className="about-pillars">
        {[
          ['01', 'Choose with confidence', 'Explore a considered edit of rings, necklaces, bracelets, and earrings, made easier to navigate around your style.'],
          ['02', 'Make it personal', 'Find a signature piece, choose a thoughtful gift, or save a favourite for the moment that feels right.'],
          ['03', 'We are here to help', 'Our Lagos-based team is ready to answer questions and make every detail of your order feel considered.'],
        ].map(([number, title, text]) => (
          <article key={number} className="about-pillar">
            <span className="about-pillar__number">{number}</span>
            <h2>{title}</h2>
            <p>{text}</p>
            <span className="about-pillar__rule" aria-hidden="true" />
          </article>
        ))}
      </section>

      <section className="about-contact">
        <div>
          <p className="eyebrow">We would love to help</p>
          <h2>Tell us what you are looking for.</h2>
          <p>For styling questions, gifting, or a special request, our team is just a note away.</p>
        </div>
        <a className="button-primary" href="mailto:abideenqudusolarenwaju@gmail.com">Speak with our team <span aria-hidden="true">↗</span></a>
      </section>
    </div>
  )
}

function BridalPage({
  onQuickView,
}: {
  onQuickView: (product: Product) => void
}) {
  const { state } = useStore()
  const bridalProducts = state.products.filter((product) => product.category === 'Rings').slice(0, 3)

  return (
    <div className="page-stack">
      <section className="editorial-hero editorial-hero--bridal glass-card">
        <div className="editorial-hero__copy">
          <p className="eyebrow">Bridal collections</p>
          <h1>Until Time Ends</h1>
          <p>
            An exclusive suite of engagement and wedding rings, handcrafted to commemorate lifelong devotion.
          </p>
        </div>
        <div className="editorial-hero__panel">
          <span>Private appointments</span>
          <strong>Engagement, wedding bands, and lifelong care.</strong>
          <p>Tailored for unique love stories, bespoke settings, and generational care.</p>
          <img
            className="story-hero__image"
            src={heroImages.bridalHero}
            alt="Bridal editorial reference"
          />
        </div>
      </section>

      <section className="split-content">
        <article className="glass-card content-block">
          <p className="eyebrow">Lumina diamond</p>
          <h2>The bridal standard</h2>
          <p>Conscious sourcing, superior cut, and lifetime care in a single narrative.</p>
        </article>
        <article className="glass-card content-block">
          <p className="eyebrow">Curated designs</p>
          <h2>Appointment-led selection</h2>
          <p>Refined for customers who expect a premium journey, not just a product page.</p>
        </article>
      </section>

      <section className="content-section">
        <SectionHeading eyebrow="Curated designs" title="Bridal-ready pieces from the existing catalog." />
        <div className="product-grid product-grid--shop">
          {bridalProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onQuickAdd={() => navigate(`/product/${product.slug}`)}
              onWishlist={() => undefined}
              onQuickView={() => onQuickView(product)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function HighJewelryPage({
  onQuickView,
}: {
  onQuickView: (product: Product) => void
}) {
  const { state } = useStore()
  const rarePieces = state.products
    .slice()
    .sort((left, right) => right.price - left.price)
    .slice(0, 3)

  return (
    <div className="page-stack">
      <section className="high-jewelry-hero glass-card">
        <div className="high-jewelry-hero__copy">
          <p className="eyebrow">High jewelry</p>
          <h1>The Alchemist's Dream</h1>
          <p>
            Our masterworks represent the peak of artistic jewelry, where exceptional gems find their eternal form.
          </p>
        </div>
        <div className="high-jewelry-hero__panel">
          <span>By appointment only</span>
          <strong>Rare stones, rare settings, rare access.</strong>
          <p>A curated selection of singular treasures, reserved for private viewings and bespoke commissions.</p>
          <img
            className="story-hero__image"
            src={heroImages.highJewelryHero}
            alt="High jewelry editorial reference"
          />
        </div>
      </section>

      <section className="high-jewelry-grid">
        <article className="glass-card high-jewelry-card high-jewelry-card--large">
          <p className="eyebrow">Summer 2024</p>
          <h2>The Celestial Suite</h2>
          <p>Rare Colombian emeralds, meticulously set in hand-carved platinum and designed to captivate.</p>
        </article>
        <article className="glass-card high-jewelry-card">
          <p className="eyebrow">Rare stone</p>
          <h3>L'Emeraude de Minuit</h3>
          <p>A mesmerizing 8-carat deep green emerald, catching the moonlight in a modern geometric setting.</p>
        </article>
        <article className="glass-card high-jewelry-card">
          <p className="eyebrow">Private inquiry</p>
          <h3>Bespoke consultations</h3>
          <p>Gain exclusive access to our private salon for a personalized, bespoke design consultation.</p>
        </article>
      </section>

      <section className="content-section">
        <SectionHeading eyebrow="The Collection" title="Masterpieces of unparalleled craftsmanship and design." />
        <div className="product-grid product-grid--shop">
          {rarePieces.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onQuickAdd={() => navigate(`/product/${product.slug}`)}
              onWishlist={() => undefined}
              onQuickView={() => onQuickView(product)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function ShopPage({
  onQuickView,
}: {
  onQuickView: (product: Product) => void
}) {
  const { state, addToCart, toggleWishlist } = useStore()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'All' | Product['category']>(() => {
    const requestedCategory = new URLSearchParams(window.location.search).get('category')
    const categories: Product['category'][] = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Watches']
    return categories.find((item) => item === requestedCategory) ?? 'All'
  })
  const [sort, setSort] = useState<'featured' | 'low' | 'high' | 'rating'>('featured')
  const [showFilters, setShowFilters] = useState(false)
  const normalizedQuery = query.trim().toLowerCase()

  const filtered = state.products
    .filter((product) => product.status === 'Active')
    .filter((product) =>
      [product.name, product.description, product.material, product.gemstone]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    )
    .filter((product) => category === 'All' || product.category === category)
    .sort((left, right) => {
      if (sort === 'featured') return Number(right.featured) - Number(left.featured)
      if (sort === 'low') return left.price - right.price
      if (sort === 'high') return right.price - left.price
      return right.rating - left.rating
    })

  return (
    <div className="page-stack">
      <section className="shop-intro">
        <div>
          <p className="eyebrow">The Lumina collection</p>
          <h1>Find the piece that feels like you.</h1>
          <p>
            Explore jewelry for everyday rituals, thoughtful gifts, and moments worth
            remembering. Filter by style and discover your next favourite.
          </p>
        </div>
        <div className="shop-intro__note">
          <span className="material-symbols-outlined" aria-hidden="true">diamond</span>
          <span>Designed to be worn, loved, and made your own.</span>
        </div>
      </section>

      <nav className="shop-categories" aria-label="Shop by category">
        {(['All', 'Rings', 'Necklaces', 'Earrings', 'Bracelets', 'Watches'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={category === item ? 'is-active' : ''}
            onClick={() => setCategory(item)}
            aria-pressed={category === item}
          >
            {item === 'All' ? 'All pieces' : item}
          </button>
        ))}
      </nav>

      <section className="shop-layout">
        <button
          type="button"
          className="filter-toggle"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
        >
          <span className="material-symbols-outlined">
            {showFilters ? 'expand_less' : 'tune'}
          </span>
          Refine your search
        </button>
        <aside className={`filter-panel glass-card filter-panel--collapsible ${showFilters ? 'is-open' : ''}`}>
          <p className="eyebrow">Refine</p>
          <label className="field">
            <span>Search the collection</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “gold” or “pearl”" />
          </label>
          <label className="field">
            <span>Shop by style</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
              <option value="All">All pieces</option>
              <option value="Rings">Rings</option>
              <option value="Necklaces">Necklaces</option>
              <option value="Bracelets">Bracelets</option>
              <option value="Earrings">Earrings</option>
              <option value="Watches">Watches</option>
            </select>
          </label>
          <label className="field">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="featured">Recommended</option>
              <option value="low">Price: low to high</option>
              <option value="high">Price: high to low</option>
              <option value="rating">Highest rated</option>
            </select>
          </label>
          {(query || category !== 'All') && (
            <button
              type="button"
              className="shop-clear-filters"
              onClick={() => {
                setQuery('')
                setCategory('All')
              }}
            >
              Clear filters
            </button>
          )}
          <div className="filter-panel__note">
            Complimentary delivery on orders of NGN 300,000 and above.
          </div>
        </aside>

        <div className="shop-results">
          <div className="shop-toolbar">
            <span><strong>{filtered.length}</strong> {filtered.length === 1 ? 'piece' : 'pieces'} to explore</span>
            <LinkButton href="/bag" className="button-ghost">View your bag</LinkButton>
          </div>
          {filtered.length > 0 ? (
            <div className="product-grid product-grid--shop">
              {filtered.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onQuickAdd={() => addToCart(product.id)}
                  onWishlist={() => toggleWishlist(product.id)}
                  onQuickView={() => onQuickView(product)}
                />
              ))}
            </div>
          ) : (
            <div className="shop-empty-state">
              <span className="material-symbols-outlined" aria-hidden="true">search_off</span>
              <h2>No pieces found just yet.</h2>
              <p>Try another search or clear your filters to explore the full collection.</p>
              <button
                type="button"
                className="button-ghost"
                onClick={() => {
                  setQuery('')
                  setCategory('All')
                }}
              >
                Show all pieces
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ProductPage({
  product,
  onQuickView,
}: {
  product: Product
  onQuickView: (product: Product) => void
}) {
  const { state, addToCart, toggleWishlist } = useStore()
  const isAdmin = state.user?.role === 'admin'
  const [activeIndex, setActiveIndex] = useState(0)
  const isWishlisted = state.wishlist.includes(product.id)
  const related = state.products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 3)
  const gallery = [product.image, ...(product.gallery ?? [])].slice(0, 4)
  const activeImage = gallery[activeIndex] ?? product.image

  const buyButtonRef = useRef<HTMLDivElement>(null)
  const [showSticky, setShowSticky] = useState(false)

  useEffect(() => {
    const target = buyButtonRef.current
    if (!target) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowSticky(!entry.isIntersecting)
      },
      { threshold: 0 }
    )

    observer.observe(target)
    return () => {
      observer.disconnect()
    }
  }, [product.id])

  return (
    <div className="page-stack">
      <section className="product-detail">
        <div className="product-detail__visual glass-card">
          <div className="product-detail__visual-inner">
            <div className="product-gallery">
              <SafeImage className="product-gallery__main" src={activeImage} alt={product.name} />
              <div className="product-gallery__thumbs">
                {gallery.map((image, index) => (
                  <button
                    key={image}
                    type="button"
                    className={`product-gallery__thumb ${activeImage === image ? 'is-active' : ''}`}
                    onClick={() => setActiveIndex(index)}
                  >
                    <SafeImage src={image} alt={`${product.name} view ${index + 2}`} />
                  </button>
                ))}
              </div>
            </div>
            <span className="hero-visual__label">{product.badge ?? 'Curated'}</span>
          </div>
        </div>
        <div className="product-detail__copy">
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
          <p className="product-detail__lede">{product.description}</p>
          <div className="price-row">
            <strong>{formatNaira(product.price)}</strong>
            {product.compareAtPrice && <span>{formatNaira(product.compareAtPrice)}</span>}
          </div>
          <div className="detail-pills">
            <span>{product.material}</span>
            <span>{product.gemstone}</span>
            <span>{product.rating.toFixed(1)} rating</span>
          </div>
          <p>{product.story}</p>
          <div className="hero-actions" ref={buyButtonRef}>
            {isAdmin ? (
              <LinkButton
                href={`/admin/products?product=${encodeURIComponent(product.id)}`}
                className="button-primary"
              >
                Edit product
              </LinkButton>
            ) : (
              <>
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => addToCart(product.id)}
                >
                  Add to bag
                </button>
                <button
                  type="button"
                  className={`button-ghost ${isWishlisted ? 'is-active' : ''}`}
                  onClick={() => toggleWishlist(product.id)}
                >
                  {isWishlisted ? 'Saved to wishlist' : 'Save for later'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="detail-grid">
        <article className="glass-card info-card">
          <h2>Artisanal craftsmanship</h2>
          <p>
            Every line is tuned to the mockup language: clean surfaces, sharp edges, and
            restrained gold accents.
          </p>
        </article>
        <article className="glass-card info-card">
          <h2>Care and delivery</h2>
          <p>
            Complimentary polishing guidance, secure packaging, and Lagos-first support
            with nationwide delivery.
          </p>
        </article>
        <article className="glass-card info-card">
          <h2>Private refinement</h2>
          <p>
            Book a stylist session for custom pairings, bridal edits, or gifting support.
          </p>
        </article>
      </section>

      <section className="content-section">
        <SectionHeading eyebrow="Complete the look" title="Pieces that pair naturally with this selection." />
        <div className="product-grid product-grid--shop">
          {related.map((item) => (
            <ProductCard
              key={item.id}
              product={item}
              onQuickAdd={() => addToCart(item.id)}
              onWishlist={() => toggleWishlist(item.id)}
              onQuickView={() => onQuickView(item)}
            />
          ))}
        </div>
      </section>
      {showSticky && !isAdmin && (
        <div className="sticky-buy-bar">
          <div className="sticky-buy-bar__inner">
            <div className="sticky-buy-bar__product">
              <SafeImage src={product.image} alt={product.name} />
              <div className="sticky-buy-bar__copy">
                <strong>{product.name}</strong>
                <span>{formatNaira(product.price)}</span>
              </div>
            </div>
            <button
              type="button"
              className="button-primary button-primary--small"
              onClick={() => addToCart(product.id)}
            >
              Add to bag
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BagPage() {
  const { state, setCartQuantity, removeFromCart } = useStore()
  const items = state.cart
    .map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId)
      return product ? { ...item, product } : null
    })
    .filter(Boolean) as Array<{ productId: string; quantity: number; product: Product }>

  const subtotal = computeCartSubtotal(state.products, state.cart)
  const shippingFee = getShippingFee(subtotal)
  const total = subtotal + shippingFee

  return (
    <div className="page-stack">
      <section className="page-hero">
        <p className="eyebrow">Shopping bag</p>
        <h1>Your selection</h1>
        <p>Review the pieces before moving into the mock checkout flow.</p>
        <div className="hero-actions">
          <LinkButton href="/" className="button-ghost">Back to home</LinkButton>
          {state.user && <LinkButton href="/account" className="button-ghost">My dashboard</LinkButton>}
        </div>
      </section>

      {items.length === 0 ? (
        <div className="glass-card empty-state">
          <h2>Your bag is empty</h2>
          <p>Continue browsing the collection to find your next statement piece.</p>
          <LinkButton href="/shop" className="button-primary">
            Shop collection
          </LinkButton>
        </div>
      ) : (
        <section className="bag-layout">
          <div className="bag-list">
            {items.map(({ product, quantity }) => (
              <article key={product.id} className="glass-card bag-item">
                <div className="bag-item__visual">
                  <SafeImage src={product.image} alt={product.name} />
                </div>
                <div className="bag-item__copy">
                  <h2>{product.name}</h2>
                  <p>{product.material}</p>
                  <strong>{formatNaira(product.price)}</strong>
                </div>
                <div className="bag-item__actions">
                  <div className="qty-control">
                    <button type="button" onClick={() => setCartQuantity(product.id, quantity - 1)}>
                      -
                    </button>
                    <span>{quantity}</span>
                    <button type="button" onClick={() => setCartQuantity(product.id, quantity + 1)}>
                      +
                    </button>
                  </div>
                  <button type="button" className="text-button" onClick={() => removeFromCart(product.id)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>

          <aside className="summary-panel glass-card">
            <h2>Summary</h2>
            <div className="summary-row">
              <span>Subtotal</span>
              <strong>{formatNaira(subtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Shipping</span>
              <strong>{shippingFee === 0 ? 'Free' : formatNaira(shippingFee)}</strong>
            </div>
            <div className="summary-row summary-row--total">
              <span>Total</span>
              <strong>{formatNaira(total)}</strong>
            </div>
            <LinkButton href={state.user ? '/checkout' : '/login?redirect=%2Fcheckout'} className="button-primary">
              Continue to checkout
            </LinkButton>
            <LinkButton
              href={state.user ? '/account#addresses' : `/login?redirect=${encodeURIComponent('/account#addresses')}`}
              className="button-ghost button-ghost--small"
            >
              Manage saved addresses
            </LinkButton>
            {state.user && (
              <LinkButton href="/account" className="button-ghost button-ghost--small">
                My dashboard
              </LinkButton>
            )}
            {!state.user && (
              <LinkButton href="/login?redirect=%2Faccount" className="button-ghost button-ghost--small">
                Sign in to your dashboard
              </LinkButton>
            )}
            <p className="summary-note">Secure Paystack checkout with naira pricing and Nigeria-friendly copy.</p>
          </aside>
        </section>
      )}
    </div>
  )
}

function CheckoutPage() {
  const { state, placeOrder } = useStore()
  const [submitted, setSubmitted] = useState(false)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([])
  const [savedAddressError, setSavedAddressError] = useState<string | null>(null)
  const addressTouchedRef = useRef(false)
  const [paidPaystackReference, setPaidPaystackReference] = useState<string | null>(null)
  const [paystackPaid, setPaystackPaid] = useState(false)
  const [paystackPaying, setPaystackPaying] = useState(false)
  const [paystackError, setPaystackError] = useState<string | null>(null)
  const initialCity = state.user?.city ?? ''
  const initialState = getNigeriaStateForCity(initialCity)
  const [form, setForm] = useState<CheckoutFormState>(() => ({
    fullName: state.user?.name ?? '',
    email: state.user?.email ?? '',
    phone: state.user?.phone ?? '',
    city: initialState ? initialCity : '',
    state: initialState,
    country: 'Nigeria',
    street: '',
    deliveryNote: '',
    paymentMethod: 'Paystack',
    newsletter: true,
  }))

  useEffect(() => {
    const user = state.user
    if (!user) return
    const userId = user.id
    let active = true

    async function loadSavedAddresses() {
      try {
        const addresses = hasSupabaseConfig
          ? await fetchUserAddresses(userId)
          : JSON.parse(window.localStorage.getItem(`lumina-addresses-${userId}`) ?? '[]') as SavedAddress[]
        if (!active) return
        setSavedAddresses(addresses)
        const defaultAddress = addresses.find((address) => address.isDefault)
        if (defaultAddress && !addressTouchedRef.current) {
          setForm((current) => ({
            ...current,
            fullName: defaultAddress.fullName,
            phone: defaultAddress.phone,
            street: defaultAddress.street,
            city: defaultAddress.city,
            state: defaultAddress.state,
            country: defaultAddress.country,
          }))
        }
      } catch (error) {
        if (active) {
          setSavedAddressError(error instanceof Error ? error.message : 'Unable to load saved delivery addresses.')
        }
      }
    }

    void loadSavedAddresses()
    return () => {
      active = false
    }
  }, [state.user])

  useEffect(() => {
    if (!state.user) {
      navigate('/login?redirect=%2Fcheckout')
    }
  }, [state.user])

  const checkoutPreview =
    state.cart
      .map((item) => {
        const product = state.products.find((entry) => entry.id === item.productId)
        return product ? { ...item, product } : null
      })
      .filter(Boolean)[0] as { productId: string; quantity: number; product: Product } | undefined

  const subtotal = computeCartSubtotal(state.products, state.cart)
  const shippingFee = getShippingFee(subtotal)
  const total = subtotal + shippingFee
  const paystackReady = canStartPaystack(form)
  const usesPaystack = form.paymentMethod === 'Paystack'
  const pendingPaystackReference = useMemo(() => createPaystackReference(), [])
  const paystackReference = paidPaystackReference ?? pendingPaystackReference

  useEffect(() => {
    if (submitted && state.lastOrderId) {
      navigate(`/order-confirmed?order=${state.lastOrderId}`)
    }
  }, [submitted, state.lastOrderId])

  useEffect(() => {
    if (!usesPaystack) {
      return
    }

    preloadPaystackCheckout()
  }, [usesPaystack])

  if (!state.user) {
    return null
  }

  if (state.cart.length === 0) {
    return (
      <div className="page-stack">
        <section className="page-hero">
          <p className="eyebrow">Checkout</p>
          <h1>Nothing to pay for yet</h1>
          <p>Add a piece to your bag before checking out.</p>
          <LinkButton href="/shop" className="button-primary">
            Browse collections
          </LinkButton>
        </section>
      </div>
    )
  }

  function updateField<K extends keyof CheckoutFormState>(key: K, value: CheckoutFormState[K]) {
    if (['fullName', 'phone', 'city', 'state', 'country', 'street'].includes(key)) {
      addressTouchedRef.current = true
    }
    setForm((current) => key === 'state'
      ? { ...current, state: value as string, city: '' }
      : { ...current, [key]: value })
    if (key === 'paymentMethod' && value !== 'Paystack') {
      setPaystackError(null)
    }
  }

  async function startPaystackPayment() {
    if (!paystackReady || paystackPaying) {
      return
    }

    setPaystackPaying(true)
    setPaystackError(null)

    try {
      const result = hasPaystackConfig
        ? await initiatePaystackPayment({
            email: form.email,
            amountKobo: total * 100,
            reference: paystackReference,
            name: form.fullName,
            phone: form.phone,
            metadata: {
              city: form.city,
              state: form.state,
              street: form.street,
            },
        })
        : await simulatePaystackPayment(paystackReference)

      setPaidPaystackReference(result.reference)
      setPaystackPaid(true)
    } catch (error) {
      setPaystackError(error instanceof Error ? error.message : 'Payment could not be completed.')
    } finally {
      setPaystackPaying(false)
    }
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault()
    setOrderError(null)

    if (usesPaystack && !paystackPaid) {
      setPaystackError('Secure your order with Paystack before placing it.')
      return
    }

    setIsPlacingOrder(true)
    try {
      await placeOrder(form, {
        reference: paystackPaid ? paystackReference : null,
        paid: paystackPaid,
      })
      setSubmitted(true)
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Your order could not be saved. Please try again.')
    } finally {
      setIsPlacingOrder(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <p className="eyebrow">Checkout</p>
        <h1>Private checkout</h1>
        <p>Streamlined for premium conversion with cleaner spacing and editorial tone.</p>
      </section>

      <form className="checkout-layout" onSubmit={submitOrder}>
        <div className="checkout-form">
          <section className="glass-card form-section">
            <div className="checkout-section-heading">
              <span>01</span>
              <h2>Contact information</h2>
            </div>
            {savedAddressError && <p className="form-error" role="alert">{savedAddressError}</p>}
            {savedAddresses.length > 0 && (
              <label className="field">
                <span>Use a saved delivery address</span>
                <select
                  className="address-location-select"
                  value=""
                  onChange={(event) => {
                    const address = savedAddresses.find((item) => item.id === event.target.value)
                    if (!address) return
                    addressTouchedRef.current = true
                    setForm((current) => ({
                      ...current,
                      fullName: address.fullName,
                      phone: address.phone,
                      street: address.street,
                      city: address.city,
                      state: address.state,
                      country: address.country,
                    }))
                  }}
                >
                  <option value="">Select a saved address</option>
                  {savedAddresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.label}{address.isDefault ? ' · Default' : ''} — {formatAddressCityState(address.city, address.state)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <LinkButton href="/account#addresses" className="checkout-address-link">
              <span className="material-symbols-outlined" aria-hidden="true">edit_location_alt</span>
              Manage saved addresses
            </LinkButton>
            <div className="form-grid">
              <label className="field">
                <span>Full name</span>
                <input
                  value={form.fullName}
                  onChange={(event) => updateField('fullName', event.target.value)}
                />
              </label>
              <label className="field">
                <span>Email address</span>
                <input
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  type="email"
                />
              </label>
              <label className="field">
                <span>Phone number</span>
                <input
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                />
              </label>
              <label className="field">
                <span>State</span>
                <select
                  value={form.state}
                  className="address-location-select"
                  required
                  onChange={(event) => updateField('state', event.target.value)}
                >
                  <option value="">Select a state</option>
                  {nigeriaStates.map((stateName) => (
                    <option key={stateName} value={stateName}>
                      {stateName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>City / town</span>
                <select
                  value={citySelectValue(form.state, form.city)}
                  className="address-location-select"
                  onChange={(event) => updateField('city', event.target.value)}
                  required
                  disabled={!form.state}
                >
                  <option value="">{form.state ? 'Select a city or town' : 'Select a state first'}</option>
                  {(nigeriaCitiesByState[form.state] ?? []).map((cityName) => (
                    <option key={cityName} value={cityName}>{cityName}</option>
                  ))}
                  <option value={otherCityValue}>Other (enter manually)</option>
                </select>
                {(form.city === otherCityValue ||
                  (Boolean(form.city) && citySelectValue(form.state, form.city) === otherCityValue)) && (
                  <input
                    aria-label="Enter city or town"
                    placeholder="Enter your city or town"
                    value={form.city === otherCityValue ? '' : form.city}
                    onChange={(event) => updateField('city', event.target.value)}
                    autoComplete="address-level2"
                    required
                  />
                )}
              </label>
              <label className="field">
                <span>Street address</span>
                <input
                  value={form.street}
                  onChange={(event) => updateField('street', event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="glass-card form-section">
            <div className="checkout-section-heading">
              <span>02</span>
              <h2>Delivery and payment</h2>
            </div>
            <label className="field">
              <span>Delivery note</span>
              <textarea
                rows={4}
                value={form.deliveryNote}
                onChange={(event) => updateField('deliveryNote', event.target.value)}
              />
            </label>
            <div className="radio-grid">
              {(['Paystack', 'Transfer', 'Pay on delivery'] as const).map((method) => (
                <label key={method} className={`radio-card ${form.paymentMethod === method ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={form.paymentMethod === method}
                    onChange={() => updateField('paymentMethod', method)}
                  />
                  <span>{method === 'Paystack' ? 'Paystack (card, bank, USSD)' : method}</span>
                </label>
              ))}
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.newsletter}
                onChange={(event) => updateField('newsletter', event.target.checked)}
              />
              <span>Keep me updated on new drops and private viewing events.</span>
            </label>
          </section>
        </div>

        <aside className="summary-panel glass-card checkout-summary">
          <p className="eyebrow">Order summary</p>
          <h2>{formatNaira(total)}</h2>
          <div className="checkout-summary-card">
            <img
              src={checkoutPreview?.product.image ?? state.products[0]?.image}
              alt="Selected product preview"
            />
            <div>
              <strong>{checkoutPreview?.product.name ?? 'Selected pieces'}</strong>
              <span>Premium packaging and concierge delivery</span>
            </div>
          </div>
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>{formatNaira(subtotal)}</strong>
          </div>
          <div className="summary-row">
            <span>Shipping</span>
            <strong>{shippingFee === 0 ? 'Free' : formatNaira(shippingFee)}</strong>
          </div>
          <div className="summary-row summary-row--total">
            <span>Total</span>
            <strong>{formatNaira(total)}</strong>
          </div>

          {usesPaystack && (
            <section className="paystack-panel">
              <div className="paystack-panel__head">
                <span className="material-symbols-outlined">lock</span>
                <div>
                  <strong>Pay while you finish your address</strong>
                  <p>
                    Once your name, email, and phone are filled in, you can pay securely with
                    Paystack and keep completing delivery details.
                  </p>
                </div>
              </div>

              <div className={`paystack-status ${paystackPaid ? 'is-paid' : paystackReady ? 'is-ready' : ''}`}>
                <span>{paystackPaid ? 'Payment secured' : paystackReady ? 'Ready to pay' : 'Enter contact details'}</span>
                {paystackPaid ? (
                  <strong>Ref {paystackReference}</strong>
                ) : (
                  <strong>{formatNaira(total)}</strong>
                )}
              </div>

              <button
                type="button"
                className="button-primary paystack-panel__button"
                disabled={!paystackReady || paystackPaying || paystackPaid}
                onClick={startPaystackPayment}
              >
                {paystackPaid
                  ? 'Payment complete'
                  : paystackPaying
                    ? 'Opening Paystack…'
                    : hasPaystackConfig
                      ? 'Pay with Paystack'
                      : 'Simulate Paystack payment'}
              </button>

              {!hasPaystackConfig && (
                <p className="summary-note">
                  Add <code>VITE_PAYSTACK_PUBLIC_KEY</code> to enable live Paystack checkout.
                </p>
              )}

              {paystackError && <p className="paystack-panel__error">{paystackError}</p>}
            </section>
          )}

          {orderError && <p className="form-error" role="alert">{orderError}</p>}
          <button className="button-primary" type="submit" disabled={isPlacingOrder || (usesPaystack && !paystackPaid)}>
            {isPlacingOrder ? 'Saving order…' : usesPaystack ? 'Place paid order' : 'Place secure order'}
          </button>
          <p className="summary-note">
            {usesPaystack
              ? 'Paystack secures card, bank transfer, and USSD while you complete shipping details.'
              : 'Bank transfer and pay-on-delivery orders are confirmed immediately.'}
          </p>
        </aside>
      </form>
    </div>
  )
}

function ConfirmationPage({ orderId }: { orderId: string | null }) {
  const { state } = useStore()
  const order =
    state.orders.find((entry) => entry.id === orderId) ??
    state.orders.find((entry) => entry.id === state.lastOrderId) ??
    state.orders[0]

  return (
    <div className="page-stack">
      <section className="confirmation-panel glass-card">
        <p className="eyebrow">Order confirmed</p>
        <h1>Thank you, your order is in motion.</h1>
        <p>
          Order number <strong>{order.number}</strong> was created on {formatDateTime(order.createdAt)}.
        </p>
        <div className="confirmation-grid">
          <div>
            <span>Status</span>
            <strong>{order.status}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatNaira(order.total)}</strong>
          </div>
          <div>
            <span>Delivery city</span>
            <strong>{order.shippingCity}</strong>
          </div>
          <div>
            <span>Payment</span>
            <strong>{order.paymentStatus}</strong>
          </div>
        </div>
        {order.paystackReference && (
          <p className="summary-note">Paystack reference: {order.paystackReference}</p>
        )}
        <div className="hero-actions">
          <LinkButton href="/account" className="button-primary">
            View account
          </LinkButton>
          <LinkButton href="/shop" className="button-ghost">
            Continue shopping
          </LinkButton>
        </div>
      </section>
    </div>
  )
}

function AuthBrandPanel({ isRegister = false }: { isRegister?: boolean }) {
  return (
    <div className="auth-shell__brand">
      <div className="auth-shell__brand-copy">
        <p className="eyebrow">Lumina Atelier</p>
        <div className="auth-shell__accent-line" />
        <h1>{isRegister ? 'A new chapter in personal style.' : 'A more personal way to collect.'}</h1>
        <p>
          {isRegister
            ? 'Create your Lumina account to keep your favourite pieces close and follow every order.'
            : 'Your saved pieces, order updates, and private collections, all gathered in one place.'}
        </p>
      </div>
      <div className="auth-shell__brand-note">
        <span className="auth-shell__brand-gem" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M5 11.5 10 5h12l5 6.5L16 27 5 11.5Z" />
            <path d="M5 11.5h22M10 5l3 6.5 3 15 3-15L22 5" />
          </svg>
        </span>
        <span>
          <strong>Made to feel like yours</strong>
          <span>Discover the Lumina experience</span>
        </span>
      </div>
    </div>
  )
}

interface PasswordFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete: string
  minLength?: number
}

function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false)
  const label = isVisible ? 'Hide password' : 'Show password'

  return (
    <label className="field">
      <span>Password</span>
      <div className="password-field">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={isVisible ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setIsVisible((current) => !current)}
          aria-label={label}
          aria-pressed={isVisible}
          title={label}
        >
          {isVisible ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m3 3 18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4.1 9.5 7a11.7 11.7 0 0 1-2.1 3.4" />
              <path d="M6.6 6.6A11.4 11.4 0 0 0 2.5 12C3.5 14.9 7 19 12 19a9.7 9.7 0 0 0 4.2-.9" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M2.5 12C3.5 9.1 7 5 12 5s8.5 4.1 9.5 7c-1 2.9-4.5 7-9.5 7S3.5 14.9 2.5 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </label>
  )
}

function LoginPage() {
  const { state, signIn, demoSignIn, resetPassword, authReady } = useStore()
  const route = useRouteInfo()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const [showPasswordReset, setShowPasswordReset] = useState(() => route.query.get('reset') === 'true')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const redirectPath = route.query.get('redirect') || '/account'
  const signedInDestination =
    state.user?.role === 'admin' && redirectPath === '/account' ? '/admin' : redirectPath

  useEffect(() => {
    if (!state.user) {
      return
    }

    navigate(signedInDestination)
  }, [state.user, signedInDestination])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const resolvedEmail = email.trim()
      if (!resolvedEmail || !password.trim()) {
        throw new Error('Enter your email and password.')
      }

      await signIn(resolvedEmail, password)
      navigate(signedInDestination)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to sign in.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleDemoSignIn(role: UserRole, name: string, demoEmail: string, destination: string) {
    demoSignIn(role, name, demoEmail)
    navigate(destination)
  }

  async function submitPasswordReset(event: FormEvent) {
    event.preventDefault()
    setResetError(null)
    setResetNotice(null)
    setIsResetting(true)

    try {
      const resolvedEmail = email.trim()
      if (!resolvedEmail) {
        throw new Error('Enter your email address first.')
      }

      const message = await resetPassword(resolvedEmail)
      setResetNotice(message)
    } catch (submitError) {
      setResetError(
        submitError instanceof Error ? submitError.message : 'Unable to send reset instructions.',
      )
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <div className="auth-shell">
      <AuthBrandPanel />
      <div className="auth-shell__form">
        <div className="auth-shell__form-heading">
          <p className="auth-form__eyebrow">Lumina Atelier <span>/</span> Member access</p>
          <h2>Welcome back</h2>
          <p>
            {hasSupabaseConfig
              ? 'Sign in with your Supabase account to continue shopping.'
              : 'Sign in to continue shopping and view your private account.'}
          </p>
        </div>
        {route.query.get('confirmed') === '1' && (
          <p className="form-notice email-confirmation-notice" role="status">
            Your email is confirmed. Sign in to continue to your account.
          </p>
        )}

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <PasswordField
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <div className="auth-inline-actions">
            <button
              type="button"
              className="auth-link auth-link-button"
              onClick={() => setShowPasswordReset((current) => !current)}
            >
              Forgot password?
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="button-primary" type="submit" disabled={!authReady || isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {showPasswordReset && (
          <form className="password-reset-card" onSubmit={submitPasswordReset}>
            <div>
              <h3>Reset your password</h3>
              <p>Enter your account email and we will send reset instructions.</p>
            </div>
            <label className="field">
              <span>Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            {resetError && <p className="form-error">{resetError}</p>}
            {resetNotice && <p className="form-notice">{resetNotice}</p>}
            <button className="button-ghost button-ghost--small" type="submit" disabled={!authReady || isResetting}>
              {isResetting ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-form__footer">
          <p>
            New to Lumina?{' '}
            <LinkButton href={`/register${redirectPath !== '/account' ? `?redirect=${encodeURIComponent(redirectPath)}` : ''}`} className="auth-link">
              Create an account
            </LinkButton>
          </p>
          {!hasSupabaseConfig && (
            <div className="auth-demo-row">
              <button
                type="button"
                className="button-ghost button-ghost--small"
                onClick={() =>
                  handleDemoSignIn('customer', 'Julianna Sterling', 'julianna@example.com', '/account')
                }
              >
                Customer demo
              </button>
              <button
                type="button"
                className="button-ghost button-ghost--small"
                onClick={() => handleDemoSignIn('admin', 'Lumina Admin', 'admin@lumina.ng', '/admin')}
              >
                Admin demo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RegisterPage() {
  const { signUp, authReady } = useStore()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [stateName, setStateName] = useState('')
  const [city, setCity] = useState('')
  const [isOtherCity, setIsOtherCity] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const route = useRouteInfo()
  const redirectPath = route.query.get('redirect') || '/account'
  const passwordChecks = [
    { label: 'At least 8 characters', valid: password.length >= 8 },
    { label: 'One uppercase letter', valid: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', valid: /[a-z]/.test(password) },
    { label: 'One number', valid: /\d/.test(password) },
    { label: 'One special character', valid: /[^A-Za-z0-9]/.test(password) },
  ]
  const passwordStrength = passwordChecks.filter((check) => check.valid).length
  const emailsMatch =
    confirmEmail.length === 0 || email.trim().toLowerCase() === confirmEmail.trim().toLowerCase()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setIsSubmitting(true)

    try {
      const resolvedName = name.trim()
      const resolvedEmail = email.trim()
      const resolvedConfirmEmail = confirmEmail.trim()
      if (!resolvedName || !resolvedEmail || !resolvedConfirmEmail || !password || !stateName || !city.trim()) {
        throw new Error('Fill in your name, email, state, city, and password.')
      }
      if (resolvedEmail.toLowerCase() !== resolvedConfirmEmail.toLowerCase()) {
        throw new Error('Your email addresses do not match.')
      }
      if (passwordChecks.some((check) => !check.valid)) {
        throw new Error('Choose a strong password that meets all the requirements.')
      }

      const confirmationMessage = await signUp(
        resolvedName,
        resolvedEmail,
        password,
        city.trim(),
        stateName,
        marketingEmailOptIn,
      )

      if (confirmationMessage) {
        setNotice(confirmationMessage)
        return
      }

      navigate(redirectPath)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to create your account.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <AuthBrandPanel isRegister />
      <div className="auth-shell__form">
        <div className="auth-shell__form-heading">
          <p className="auth-form__eyebrow">Lumina Atelier <span>/</span> Your membership</p>
          <h2>Create your account</h2>
          <p>
            {hasSupabaseConfig
              ? 'Register with Supabase Auth to save pieces and track orders.'
              : 'Join Lumina to save pieces, track orders, and receive atelier updates.'}
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Full name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Confirm email</span>
            <input
              value={confirmEmail}
              onChange={(event) => {
                setConfirmEmail(event.target.value)
                if (error === 'Your email addresses do not match.') {
                  setError(null)
                }
              }}
              onBlur={() => {
                if (confirmEmail && !emailsMatch) {
                  setError('Your email addresses do not match.')
                } else if (error === 'Your email addresses do not match.') {
                  setError(null)
                }
              }}
              type="email"
              placeholder="Re-enter your email"
              autoComplete="email"
              aria-invalid={confirmEmail.length > 0 && !emailsMatch}
              aria-describedby="register-email-feedback"
              required
            />
            <span
              id="register-email-feedback"
              className={`register-field-feedback ${
                confirmEmail.length === 0 ? '' : emailsMatch ? 'is-valid' : 'is-invalid'
              }`}
              aria-live="polite"
            >
              {confirmEmail.length === 0
                ? 'Enter the same email address again.'
                : emailsMatch
                  ? 'Email addresses match.'
                  : 'Email addresses do not match.'}
            </span>
          </label>
          <label className="field">
            <span>State</span>
            <select
              className="address-location-select"
              value={stateName}
              onChange={(event) => {
                setStateName(event.target.value)
                setCity('')
                setIsOtherCity(false)
              }}
              required
            >
              <option value="">Select a state</option>
              {nigeriaStates.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>
          <label className="field">
            <span>City / town</span>
            <select
              className="address-location-select"
              value={isOtherCity ? otherCityValue : citySelectValue(stateName, city)}
              onChange={(event) => {
                const selectedCity = event.target.value
                setIsOtherCity(selectedCity === otherCityValue)
                setCity(selectedCity === otherCityValue ? '' : selectedCity)
              }}
              disabled={!stateName}
              required
            >
              <option value="">{stateName ? 'Select a city or town' : 'Select a state first'}</option>
              {(nigeriaCitiesByState[stateName] ?? []).map((cityName) => (
                <option key={cityName} value={cityName}>{cityName}</option>
              ))}
              <option value={otherCityValue}>Other (enter manually)</option>
            </select>
            {isOtherCity && (
              <input
                aria-label="Enter city or town"
                placeholder="Enter your city or town"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                autoComplete="address-level2"
                required
              />
            )}
          </label>
          <label className="marketing-email-optin">
            <input
              type="checkbox"
              checked={marketingEmailOptIn}
              onChange={(event) => setMarketingEmailOptIn(event.target.checked)}
            />
            <span>
              <strong>Email me about new pieces and atelier updates</strong>
              <small>Optional. We’ll send product announcements only if you opt in. You can change this in your account settings.</small>
            </span>
          </label>
          <PasswordField
            value={password}
            onChange={(value) => {
              setPassword(value)
              if (error === 'Choose a strong password that meets all the requirements.') {
                setError(null)
              }
            }}
            placeholder="Create a strong password"
            autoComplete="new-password"
            minLength={8}
          />
          <div className="password-strength" aria-live="polite">
            <div className="password-strength__heading">
              <span>Password strength</span>
              <strong className={`password-strength__label password-strength__label--${passwordStrength}`}>
                {password.length === 0
                  ? 'Not entered'
                  : passwordStrength <= 2
                    ? 'Weak'
                    : passwordStrength <= 4
                      ? 'Getting stronger'
                      : 'Strong'}
              </strong>
            </div>
            <div
              className={`password-strength__meter password-strength__meter--${passwordStrength}`}
              role="progressbar"
              aria-label="Password strength"
              aria-valuemin={0}
              aria-valuemax={5}
              aria-valuenow={passwordStrength}
            >
              {passwordChecks.map((check, index) => (
                <span
                  key={check.label}
                  className={index < passwordStrength ? 'is-filled' : ''}
                />
              ))}
            </div>
            <ul className="password-strength__checks">
              {passwordChecks.map((check) => (
                <li key={check.label} className={check.valid ? 'is-valid' : ''}>
                  <span aria-hidden="true">{check.valid ? '✓' : '○'}</span>
                  {check.label}
                </li>
              ))}
            </ul>
          </div>
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-notice">{notice}</p>}
          <button className="button-primary" type="submit" disabled={!authReady || isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="auth-form__footer">
          <p>
            Already have an account?{' '}
            <LinkButton href={`/login${redirectPath !== '/account' ? `?redirect=${encodeURIComponent(redirectPath)}` : ''}`} className="auth-link">
              Sign in instead
            </LinkButton>
          </p>
        </div>
      </div>
    </div>
  )
}

type AccountTab = 'overview' | 'orders' | 'wishlist' | 'profile' | 'addresses' | 'inbox'

function AccountPage() {
  const { state, signOut, toggleWishlist, addToCart, updateProfile, hideCancelledOrder } = useStore()
  const [showSignOutConfirmation, setShowSignOutConfirmation] = useState(false)
  const [hidingOrderId, setHidingOrderId] = useState<string | null>(null)
  const [orderHistoryError, setOrderHistoryError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AccountTab>(() => {
    const requestedTab = window.location.hash.slice(1)
    return requestedTab === 'wishlist' || requestedTab === 'orders' || requestedTab === 'profile' || requestedTab === 'addresses' || requestedTab === 'inbox'
      ? requestedTab
      : 'overview'
  })
  const user = state.user
  const userOrders = user
    ? [...state.orders].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    : []
  const wishlistItems = state.products.filter((product) => state.wishlist.includes(product.id))
  const cartCount = state.cart.reduce((count, item) => count + item.quantity, 0)
  const latestOrder = userOrders[0]

  function selectTab(tab: AccountTab) {
    setActiveTab(tab)
    window.history.replaceState({}, '', tab === 'overview' ? '/account' : `/account#${tab}`)
  }

  async function removeCancelledOrder(order: Order) {
    const confirmed = window.confirm(
      `Remove cancelled order ${order.number} from your order history? The store administrator will retain the order record.`,
    )
    if (!confirmed || hidingOrderId) return

    setHidingOrderId(order.id)
    setOrderHistoryError(null)
    try {
      await hideCancelledOrder(order.id)
    } catch (error) {
      setOrderHistoryError(
        error instanceof Error ? error.message : 'Unable to remove this cancelled order.',
      )
    } finally {
      setHidingOrderId(null)
    }
  }

  if (!user) {
    const wishlistRedirect = encodeURIComponent('/account#wishlist')
    return (
      <div className="page-stack">
        <section className="account-guest glass-card">
          <span className="account-guest__icon material-symbols-outlined" aria-hidden="true">person</span>
          <p className="eyebrow">Your Lumina account</p>
          <h1>A more personal way to shop.</h1>
          <p>Sign in or create an account to keep your saved pieces and shopping bag with you.</p>
          <div className="hero-actions">
            <LinkButton href={`/login?redirect=${wishlistRedirect}`} className="button-primary">Sign in</LinkButton>
            <LinkButton href={`/register?redirect=${wishlistRedirect}`} className="button-ghost">Create account</LinkButton>
            <LinkButton href="/" className="button-ghost">Back to home</LinkButton>
          </div>
        </section>
        {wishlistItems.length > 0 && (
          <section className="content-section">
            <SectionHeading
              eyebrow={`${wishlistItems.length} SAVED ${wishlistItems.length === 1 ? 'PIECE' : 'PIECES'}`}
              title="Your wishlist is here when you return."
              text="Saved pieces stay on this device until you sign in or create an account."
            />
            <div className="product-grid product-grid--shop">
              {wishlistItems.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onQuickAdd={() => addToCart(product.id)}
                  onWishlist={() => toggleWishlist(product.id)}
                  onQuickView={() => undefined}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="account-dashboard">
        <header className="account-dashboard__hero">
          <div className="account-dashboard__welcome">
            <p className="eyebrow">YOUR LUMINA ACCOUNT</p>
            <h1>Good to see you, {user.name.split(' ')[0]}.</h1>
            <p>Everything you have saved and ordered, together in one place.</p>
            <LinkButton href="/" className="button-ghost button-ghost--small account-dashboard__home-link">
              Back to home
            </LinkButton>
          </div>
          <div className="account-dashboard__identity">
            <span className="avatar-badge">{initials(user.name)}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <button
              type="button"
              className="account-dashboard__signout"
              onClick={() => setShowSignOutConfirmation(true)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">logout</span>
              Sign out
            </button>
          </div>
        </header>

        <div className="account-dashboard__body">
          <aside className="account-sidebar">
            <div className="account-sidebar__profile">
              <span className="account-sidebar__avatar">{initials(user.name)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role === 'admin' ? 'Lumina administrator' : 'Lumina member'}</small>
              </span>
            </div>
            <nav className="account-sidebar__nav" aria-label="Account sections">
              {([
                ['overview', 'Overview', 'dashboard'],
                ['orders', 'My orders', 'local_shipping'],
                ['wishlist', 'Wishlist', 'favorite'],
                ['profile', 'Account details', 'person'],
                ['addresses', 'Addresses', 'location_on'],
                ['inbox', 'Inbox', 'mail'],
              ] as const).map(([tab, label, icon]) => (
                <button
                  key={tab}
                  type="button"
                  className={activeTab === tab ? 'is-active' : ''}
                  aria-current={activeTab === tab ? 'page' : undefined}
                  onClick={() => selectTab(tab)}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
                  {label}
                  {tab === 'orders' && userOrders.length > 0 && (
                    <span className="account-sidebar__count">{userOrders.length}</span>
                  )}
                  {tab === 'wishlist' && wishlistItems.length > 0 && (
                    <span className="account-sidebar__count">{wishlistItems.length}</span>
                  )}
                  {tab === 'inbox' && <InboxUnreadCount />}
                </button>
              ))}
            </nav>
            <a className="account-sidebar__help" href="mailto:abideenqudusolarenwaju@gmail.com">
              <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
              <span><strong>Need a hand?</strong><small>Contact client care</small></span>
              <span className="material-symbols-outlined" aria-hidden="true">arrow_outward</span>
            </a>
          </aside>

          <div className="account-dashboard__content">
            {activeTab === 'overview' && (
              <section className="account-view" aria-labelledby="account-overview-title">
                <div className="account-view__heading">
                  <div>
                    <p className="eyebrow">A little overview</p>
                    <h2 id="account-overview-title">Your account at a glance</h2>
                  </div>
                  <LinkButton href="/shop" className="button-ghost button-ghost--small">
                    Explore the collection
                  </LinkButton>
                </div>

                <div className="account-metrics">
                  <article>
                    <span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>
                    <small>YOUR ORDERS</small>
                    <strong>{userOrders.length}</strong>
                    <span>{userOrders.length === 1 ? 'order placed' : 'orders placed'}</span>
                  </article>
                  <article>
                    <span className="material-symbols-outlined" aria-hidden="true">favorite</span>
                    <small>SAVED PIECES</small>
                    <strong>{wishlistItems.length}</strong>
                    <span>{wishlistItems.length === 1 ? 'piece in your wishlist' : 'pieces in your wishlist'}</span>
                  </article>
                  <article>
                    <span className="material-symbols-outlined" aria-hidden="true">shopping_bag</span>
                    <small>YOUR BAG</small>
                    <strong>{cartCount}</strong>
                    <span>{cartCount === 1 ? 'piece ready when you are' : 'pieces ready when you are'}</span>
                  </article>
                </div>

                <div className="account-overview-grid">
                  <section className="account-panel account-panel--orders">
                    <div className="account-panel__heading">
                      <div>
                        <p className="eyebrow">ORDER HISTORY</p>
                        <h3>Latest order</h3>
                      </div>
                      <button type="button" className="account-text-button" onClick={() => selectTab('orders')}>
                        View all
                        <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                      </button>
                    </div>
                    {latestOrder ? (
                      <AccountOrderSummary order={latestOrder} products={state.products} />
                    ) : (
                      <div className="account-inline-empty">
                        <span className="material-symbols-outlined" aria-hidden="true">inventory_2</span>
                        <div>
                          <strong>Your next favourite is waiting.</strong>
                          <p>Your orders will appear here once you place one.</p>
                        </div>
                        <LinkButton href="/shop" className="button-ghost button-ghost--small">Browse pieces</LinkButton>
                      </div>
                    )}
                  </section>

                  <section className="account-panel account-panel--details">
                    <div className="account-panel__heading">
                      <div>
                        <p className="eyebrow">ACCOUNT DETAILS</p>
                        <h3>Your profile</h3>
                      </div>
                      <button type="button" className="account-text-button" onClick={() => selectTab('profile')}>
                        View details
                        <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                      </button>
                    </div>
                    <dl className="account-detail-list">
                      <div><dt>Name</dt><dd>{user.name}</dd></div>
                      <div><dt>Email</dt><dd>{user.email}</dd></div>
                      <div><dt>City</dt><dd>{user.city || 'Not provided'}</dd></div>
                    </dl>
                  </section>
                </div>

                <section className="account-panel account-panel--addresses">
                  <div className="account-panel__heading">
                    <div>
                      <p className="eyebrow">DELIVERY PREFERENCES</p>
                      <h3>Saved addresses</h3>
                      <p>Update your delivery details or choose a default address for checkout.</p>
                    </div>
                    <button type="button" className="account-text-button" onClick={() => selectTab('addresses')}>
                      Manage addresses
                      <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                    </button>
                  </div>
                </section>

                {wishlistItems.length > 0 && (
                  <section className="account-panel account-panel--wishlist">
                    <div className="account-panel__heading">
                      <div>
                        <p className="eyebrow">SAVED FOR LATER</p>
                        <h3>Your wishlist</h3>
                      </div>
                      <button type="button" className="account-text-button" onClick={() => selectTab('wishlist')}>
                        View wishlist
                        <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                      </button>
                    </div>
                    <div className="account-wishlist-preview">
                      {wishlistItems.slice(0, 3).map((product) => (
                        <LinkButton key={product.id} href={`/product/${product.slug}`} className="account-wishlist-preview__item">
                          <SafeImage src={product.image} alt="" />
                          <span><strong>{product.name}</strong><small>{formatNaira(product.price)}</small></span>
                        </LinkButton>
                      ))}
                    </div>
                  </section>
                )}
              </section>
            )}

            {activeTab === 'orders' && (
              <section className="account-view" aria-labelledby="account-orders-title">
                <div className="account-view__heading">
                  <div>
                    <p className="eyebrow">ORDER HISTORY</p>
                    <h2 id="account-orders-title">Your orders</h2>
                    <p>Follow the progress of your Lumina pieces.</p>
                  </div>
                  <LinkButton href="/shop" className="button-ghost button-ghost--small">Continue shopping</LinkButton>
                </div>
                {userOrders.length > 0 ? (
                  <>
                    {orderHistoryError && <p className="form-error" role="alert">{orderHistoryError}</p>}
                    <div className="account-order-list">
                      {userOrders.map((order) => (
                        <AccountOrderSummary
                          key={order.id}
                          order={order}
                          products={state.products}
                          onHide={() => void removeCancelledOrder(order)}
                          isHiding={hidingOrderId === order.id}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="account-empty-state">
                    <span className="material-symbols-outlined" aria-hidden="true">local_shipping</span>
                    <p className="eyebrow">YOUR NEXT CHAPTER</p>
                    <h3>No orders yet</h3>
                    <p>When you place an order, its status and details will be waiting for you here.</p>
                    <LinkButton href="/shop" className="button-primary">Discover the collection</LinkButton>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'wishlist' && (
              <section className="account-view" aria-labelledby="account-wishlist-title">
                <div className="account-view__heading">
                  <div>
                    <p className="eyebrow">SAVED FOR LATER</p>
                    <h2 id="account-wishlist-title">Your wishlist</h2>
                    <p>Pieces you have saved for a future moment.</p>
                  </div>
                  <LinkButton href="/shop" className="button-ghost button-ghost--small">Find another favourite</LinkButton>
                </div>
                {wishlistItems.length > 0 ? (
                  <div className="product-grid product-grid--shop account-wishlist-grid">
                    {wishlistItems.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onQuickAdd={() => addToCart(product.id)}
                        onWishlist={() => toggleWishlist(product.id)}
                        onQuickView={() => navigate(`/product/${product.slug}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="account-empty-state">
                    <span className="material-symbols-outlined" aria-hidden="true">favorite_border</span>
                    <p className="eyebrow">A PLACE FOR YOUR FAVOURITES</p>
                    <h3>Your wishlist is waiting</h3>
                    <p>Tap the heart on a piece you love and it will be saved here for later.</p>
                    <LinkButton href="/shop" className="button-primary">Explore jewelry</LinkButton>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'profile' && (
              <AccountProfileSection key={user.id} user={user} updateProfile={updateProfile} />
            )}

            {activeTab === 'addresses' && (
              <section className="account-view account-address-view" aria-labelledby="account-address-page-title">
                <div className="account-view__heading">
                  <div>
                    <p className="eyebrow">DELIVERY PREFERENCES</p>
                    <h2 id="account-address-page-title">Your addresses</h2>
                    <p>Add, edit, or choose a default delivery address whenever you need to.</p>
                  </div>
                </div>
                <AccountAddressBook user={user} />
              </section>
            )}

            {activeTab === 'inbox' && (
              <AccountInboxView user={user} />
            )}
          </div>
        </div>
      </div>
      {showSignOutConfirmation && (
        <SignOutConfirmation
          onCancel={() => setShowSignOutConfirmation(false)}
          onConfirm={async () => {
            await signOut()
            navigate('/login')
          }}
        />
      )}
    </>
  )
}

async function loadSupportThread(userId: string): Promise<{
  conversationId: string
  messages: SupportMessage[]
}> {
  const conversationId = await getOrCreateSupportConversation(userId)
  const messages = await fetchSupportMessages(conversationId)
  const unreadSenders = [...new Set(
    messages
      .filter((message) => !message.readAt && message.senderId !== userId)
      .map((message) => message.senderId),
  )]
  await Promise.all(unreadSenders.map((senderId) => markSupportMessagesRead(conversationId, senderId)))

  return {
    conversationId,
    messages: messages.map((message) =>
      !message.readAt && message.senderId !== userId
        ? { ...message, readAt: new Date().toISOString() }
        : message,
    ),
  }
}

function getMessagingErrorMessage(error: unknown): string {
  const errorRecord =
    error && typeof error === 'object'
      ? error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
      : null
  const message =
    error instanceof Error
      ? error.message
      : typeof errorRecord?.message === 'string'
        ? errorRecord.message
        : typeof error === 'string'
          ? error
          : ''
  const code = typeof errorRecord?.code === 'string' ? errorRecord.code : ''
  const normalizedMessage = message.toLowerCase()
  if (code === 'PGRST205') {
    return 'Supabase’s API cannot see a messaging table. Verify all three tables exist; if they do, run NOTIFY pgrst, \'reload schema\'; otherwise rerun the messaging migration after schema.sql and policies.sql.'
  }
  if (
    ['PGRST204', '42P01', '42703'].includes(code)
    || normalizedMessage.includes('does not exist')
    || normalizedMessage.includes('schema cache')
  ) {
    return 'The messaging tables are not set up yet. Run supabase/customer_messaging_inbox.sql in the Supabase SQL Editor, then reload.'
  }
  if (code === '42501' || normalizedMessage.includes('permission denied') || normalizedMessage.includes('row-level security')) {
    return `Supabase denied access to messaging data${code ? ` (${code})` : ''}. Run supabase/policies.sql and supabase/customer_messaging_inbox.sql in the SQL Editor, then sign out and back in.`
  }
  if (message) {
    const details = typeof errorRecord?.details === 'string' ? ` ${errorRecord.details}` : ''
    const hint = typeof errorRecord?.hint === 'string' ? ` ${errorRecord.hint}` : ''
    return `${message}${code ? ` (${code})` : ''}${details}${hint}`
  }
  return 'Unable to connect to messaging. Check your connection and Supabase setup, then try again.'
}

function InboxUnreadCount() {
  const { state } = useStore()
  const userId = state.user?.id
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let isCurrent = true
    if (!userId) return

    const refresh = async () => {
      try {
        const notifications = await fetchInboxNotifications()
        if (isCurrent) setCount(notifications.filter((notification) => !notification.readAt).length)
      } catch {
        if (isCurrent) setCount(-1)
      }
    }

    void refresh()
    const interval = window.setInterval(() => void refresh(), 30000)
    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [userId])

  if (count === null || count === 0) return null
  return (
    <span
      className={`account-sidebar__count${count < 0 ? ' account-sidebar__count--error' : ''}`}
      title={count < 0 ? 'Inbox is unavailable; check the messaging database setup' : `${count} unread inbox messages`}
      aria-label={count < 0 ? 'Inbox unavailable' : `${count} unread inbox messages`}
    >
      {count < 0 ? '!' : count > 99 ? '99+' : count}
    </span>
  )
}

function AccountInboxView({ user }: { user: SessionUser }) {
  const [notifications, setNotifications] = useState<InboxNotification[]>([])
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true)
  const [notificationError, setNotificationError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    const refresh = async () => {
      try {
        const result = await fetchInboxNotifications()
        if (isCurrent) {
          setNotifications(result)
          setNotificationError(null)
        }
      } catch (error) {
        if (isCurrent) setNotificationError(getMessagingErrorMessage(error))
      } finally {
        if (isCurrent) setIsLoadingNotifications(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30000)
    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [user.id])

  async function openNotification(notification: InboxNotification) {
    if (!notification.readAt) {
      try {
        await markInboxNotificationRead(notification.id)
        setNotifications((current) => current.map((entry) =>
          entry.id === notification.id ? { ...entry, readAt: new Date().toISOString() } : entry,
        ))
      } catch (error) {
        setNotificationError(getMessagingErrorMessage(error))
      }
    }
    navigate(notification.href)
  }

  return (
    <section className="account-view inbox-view" aria-labelledby="account-inbox-title">
      <div className="account-view__heading">
        <div>
          <p className="eyebrow">YOUR LUMINA MAILBOX</p>
          <h2 id="account-inbox-title">Inbox & support</h2>
          <p>Read atelier updates and continue your conversation with our team.</p>
        </div>
      </div>
      <div className="inbox-view__grid">
        <section className="inbox-panel" aria-labelledby="inbox-notifications-title">
          <div className="inbox-panel__heading">
            <div>
              <p className="eyebrow">UPDATES</p>
              <h3 id="inbox-notifications-title">Notifications</h3>
            </div>
            <span className="inbox-panel__count">{notifications.filter((entry) => !entry.readAt).length}</span>
          </div>
          {notificationError && <p className="form-error" role="alert">{notificationError}</p>}
          {isLoadingNotifications ? (
            <p className="inbox-empty">Loading your updates…</p>
          ) : notifications.length ? (
            <div className="inbox-notification-list">
              {notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.id}
                  className={`inbox-notification${notification.readAt ? '' : ' is-unread'}`}
                  onClick={() => void openNotification(notification)}
                >
                  <span className="inbox-notification__icon material-symbols-outlined" aria-hidden="true">
                    {notification.type === 'product' ? 'diamond' : 'support_agent'}
                  </span>
                  <span className="inbox-notification__copy">
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{new Date(notification.createdAt).toLocaleString()}</small>
                  </span>
                  {!notification.readAt && <span className="inbox-notification__dot" aria-label="Unread" />}
                </button>
              ))}
            </div>
          ) : (
            <p className="inbox-empty">You’re all caught up. New replies and collection updates will appear here.</p>
          )}
        </section>
        <section className="inbox-panel inbox-panel--support" aria-labelledby="inbox-support-title">
          <div className="inbox-panel__heading">
            <div>
              <p className="eyebrow">CLIENT CARE</p>
              <h3 id="inbox-support-title">Message Lumina</h3>
            </div>
            <span className="material-symbols-outlined" aria-hidden="true">forum</span>
          </div>
          <SupportThread user={user} />
        </section>
      </div>
    </section>
  )
}

function SupportThread({
  user,
  conversationId: initialConversationId,
  compact = false,
}: {
  user: SessionUser
  conversationId?: string
  compact?: boolean
}) {
  const [conversationId, setConversationId] = useState(initialConversationId ?? '')
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    const refresh = async () => {
      try {
        const thread = initialConversationId
          ? {
              conversationId: initialConversationId,
              messages: await fetchSupportMessages(initialConversationId),
            }
          : await loadSupportThread(user.id)
        const unreadSenders = [...new Set(
          thread.messages
            .filter((message) => !message.readAt && message.senderId !== user.id)
            .map((message) => message.senderId),
        )]
        await Promise.all(unreadSenders.map((senderId) =>
          markSupportMessagesRead(thread.conversationId, senderId),
        ))
        if (isCurrent) {
          setConversationId(thread.conversationId)
          setMessages(thread.messages.map((message) =>
            !message.readAt && message.senderId !== user.id
              ? { ...message, readAt: new Date().toISOString() }
              : message,
          ))
          setError(null)
        }
      } catch (refreshError) {
        if (isCurrent) setError(getMessagingErrorMessage(refreshError))
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }

    void refresh()
    const interval = window.setInterval(() => void refresh(), 15000)
    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [initialConversationId, user.id])

  async function submitMessage(event: FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!conversationId || !body || isSending) return
    setIsSending(true)
    setError(null)
    setNotice(null)
    try {
      const messageId = await sendSupportMessage(conversationId, body)
      setDraft('')
      setMessages((current) => [
        ...current,
        {
          id: messageId,
          conversationId,
          senderId: user.id,
          body,
          createdAt: new Date().toISOString(),
          readAt: null,
        },
      ])
      setNotice('Message sent and saved to your support inbox.')
      try {
        await sendSupportMessageEmail(messageId)
      } catch (emailError) {
        console.error('Support message was saved, but its email notification failed.', emailError)
        setNotice('Message sent and saved. Email notifications are not available yet, but the conversation is in your website inbox.')
      }
      try {
        const thread = initialConversationId
          ? { conversationId, messages: await fetchSupportMessages(conversationId) }
          : await loadSupportThread(user.id)
        setMessages(thread.messages)
        setConversationId(thread.conversationId)
      } catch (refreshError) {
        console.error('Support message was saved, but the conversation could not be refreshed.', refreshError)
      }
    } catch (sendError) {
      setError(getMessagingErrorMessage(sendError))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className={`support-thread${compact ? ' support-thread--compact' : ''}`}>
      <div className="support-thread__messages" aria-live="polite">
        {isLoading ? (
          <p className="inbox-empty">Opening your conversation…</p>
        ) : messages.length ? (
          messages.map((message) => (
            <article
              className={`support-message${message.senderId === user.id ? ' support-message--mine' : ''}`}
              key={message.id}
            >
              <p>{message.body}</p>
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
            </article>
          ))
        ) : (
          <p className="inbox-empty">Send us a message and our client-care team will reply here.</p>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <form className="support-thread__composer" onSubmit={submitMessage}>
        <label className="visually-hidden" htmlFor={`support-message-${user.id}`}>Your message</label>
        <textarea
          id={`support-message-${user.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write your message…"
          maxLength={5000}
          rows={compact ? 2 : 3}
          required
          disabled={isLoading || isSending || !conversationId}
        />
        <button className="button-primary" type="submit" disabled={isLoading || isSending || !draft.trim()}>
          <span className="material-symbols-outlined" aria-hidden="true">send</span>
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

function AccountProfileSection({
  user,
  updateProfile,
}: {
  user: SessionUser
  updateProfile: (profile: {
    name: string
    email: string
    phone: string
    city: string
    state: string
    marketingEmailOptIn: boolean
  }) => Promise<string | null>
}) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(user.marketingEmailOptIn)
  const initialState = user.state || getNigeriaStateForCity(user.city)
  const [stateName, setStateName] = useState(initialState)
  const initialCity = isStateStoredAsCity(user.city, initialState) ? '' : user.city
  const [city, setCity] = useState(initialCity)
  const [isOtherCity, setIsOtherCity] = useState(
    Boolean(initialCity && citySelectValue(initialState, initialCity) === otherCityValue),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setProfileMessage(null)
    setProfileError(null)

    try {
      const message = await updateProfile({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        city: city.trim(),
        state: stateName,
        marketingEmailOptIn,
      })
      setProfileMessage(message ?? 'Your profile details have been saved.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Unable to update your profile.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="account-view account-profile-section" aria-labelledby="account-profile-title">
      <div className="account-view__heading">
        <div>
          <p className="eyebrow">YOUR MEMBERSHIP</p>
          <h2 id="account-profile-title">Account details</h2>
          <p>Keep your name and contact details up to date.</p>
        </div>
      </div>

      <form className="account-settings-card" onSubmit={saveProfile}>
        <div className="account-settings-card__heading">
          <div>
            <p className="eyebrow">PERSONAL INFORMATION</p>
            <h3>Profile details</h3>
          </div>
          <span className="avatar-badge">{initials(name || user.name)}</span>
        </div>
        <div className="account-settings-grid">
          <label className="field">
            <span>Full name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </label>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Contact number</span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              placeholder="+234 800 000 0000"
            />
          </label>
          <label className="field">
            <span>State</span>
            <select
              className="address-location-select"
              value={stateName}
              onChange={(event) => {
                setStateName(event.target.value)
                setCity('')
                setIsOtherCity(false)
              }}
              required
            >
              <option value="">Select a state</option>
              {nigeriaStates.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </label>
          <label className="field">
            <span>City / town</span>
            <select
              className="address-location-select"
              value={isOtherCity ? otherCityValue : citySelectValue(stateName, city)}
              onChange={(event) => {
                const selectedCity = event.target.value
                setIsOtherCity(selectedCity === otherCityValue)
                setCity(selectedCity === otherCityValue ? '' : selectedCity)
              }}
              disabled={!stateName}
              required
            >
              <option value="">{stateName ? 'Select a city or town' : 'Select a state first'}</option>
              {(nigeriaCitiesByState[stateName] ?? []).map((cityName) => (
                <option key={cityName} value={cityName}>{cityName}</option>
              ))}
              <option value={otherCityValue}>Other (enter manually)</option>
            </select>
            {isOtherCity && (
              <input
                aria-label="Enter city or town"
                placeholder="Enter your city or town"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                autoComplete="address-level2"
                required
              />
            )}
          </label>
        </div>
        <label className="marketing-email-optin">
          <input
            type="checkbox"
            checked={marketingEmailOptIn}
            onChange={(event) => setMarketingEmailOptIn(event.target.checked)}
          />
          <span>
            <strong>Email me about new pieces and atelier updates</strong>
            <small>Optional. You can unsubscribe any time by switching this off.</small>
          </span>
        </label>
        {profileError && <p className="form-error" role="alert">{profileError}</p>}
        {profileMessage && <p className="form-notice" role="status">{profileMessage}</p>}
        {hasSupabaseConfig && email.trim().toLowerCase() !== user.email.toLowerCase() && (
          <p className="account-profile-hint">
            Supabase may require you to confirm the new email address before it replaces your current one.
          </p>
        )}
        <div className="account-settings-actions">
          <span>{user.role === 'admin' ? 'Lumina administrator' : 'Lumina member'}</span>
          <button className="button-primary" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving details…' : 'Save profile'}
          </button>
        </div>
      </form>

    </section>
  )
}

function AccountAddressBook({ user }: { user: SessionUser }) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)
  const [addressMessage, setAddressMessage] = useState<string | null>(null)
  const [form, setForm] = useState<SavedAddress>(() => emptySavedAddress(user))
  const storageKey = `lumina-addresses-${user.id}`

  useEffect(() => {
    let active = true

    async function loadAddresses() {
      setIsLoading(true)
      setAddressError(null)
      try {
        let saved: SavedAddress[]
        if (hasSupabaseConfig) {
          saved = await fetchUserAddresses(user.id)
        } else {
          const serialized = window.localStorage.getItem(storageKey)
          saved = serialized ? JSON.parse(serialized) as SavedAddress[] : []
        }
        if (active) {
          setAddresses(saved)
          if (saved.length > 0) {
            setForm(saved.find((address) => address.isDefault) ?? emptySavedAddress(user))
          }
        }
      } catch (error) {
        if (active) {
          setAddressError(error instanceof Error ? error.message : 'Unable to load your saved addresses.')
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadAddresses()
    return () => {
      active = false
    }
  }, [storageKey, user])

  function beginNewAddress() {
    setForm(emptySavedAddress(user, addresses.length === 0))
    setEditingId(null)
    setIsAdding(true)
    setAddressError(null)
    setAddressMessage(null)
  }

  function beginEditAddress(address: SavedAddress) {
    setForm({ ...address, city: isStateStoredAsCity(address.city, address.state) ? '' : address.city })
    setEditingId(address.id)
    setIsAdding(true)
    setAddressError(null)
    setAddressMessage(null)
  }

  async function submitAddress(event: FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setAddressError(null)
    setAddressMessage(null)
    try {
      const savedForm = { ...form, label: form.label.trim(), fullName: form.fullName.trim(), phone: form.phone.trim(), street: form.street.trim(), city: form.city.trim(), state: form.state.trim(), country: form.country.trim() }
      if (!savedForm.isDefault && !addresses.some((address) => address.id !== editingId && address.isDefault)) {
        savedForm.isDefault = true
      }
      let savedAddress: SavedAddress
      if (hasSupabaseConfig) {
        savedAddress = await saveUserAddress(user.id, savedForm)
      } else {
        savedAddress = { ...savedForm, id: editingId ?? (globalThis.crypto?.randomUUID?.() ?? `address-${Date.now()}`) }
      }

      let updated = editingId
        ? addresses.map((address) => address.id === editingId ? savedAddress : address)
        : [savedAddress, ...addresses]
      if (savedAddress.isDefault) {
        updated = updated.map((address) => ({ ...address, isDefault: address.id === savedAddress.id }))
      } else if (updated.length > 0 && !updated.some((address) => address.isDefault)) {
        updated[0] = { ...updated[0], isDefault: true }
      }
      setAddresses(updated)
      if (!hasSupabaseConfig) {
        window.localStorage.setItem(storageKey, JSON.stringify(updated))
      }
      setIsAdding(false)
      setAddressMessage(editingId ? 'Address updated.' : 'Address added.')
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : 'Unable to save this address.')
    } finally {
      setIsSaving(false)
    }
  }

  async function makeDefault(address: SavedAddress) {
    setAddressError(null)
    setAddressMessage(null)
    try {
      const saved = await persistAddress({ ...address, isDefault: true })
      const updated = addresses.map((item) => ({ ...item, isDefault: item.id === saved.id }))
      setAddresses(updated)
      if (!hasSupabaseConfig) {
        window.localStorage.setItem(storageKey, JSON.stringify(updated))
      }
      setAddressMessage(`${saved.label} set as your default address.`)
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : 'Unable to update the default address.')
    }
  }

  async function persistAddress(address: SavedAddress) {
    if (hasSupabaseConfig) {
      return saveUserAddress(user.id, address)
    }
    return address
  }

  async function removeAddress(address: SavedAddress) {
    setAddressError(null)
    setAddressMessage(null)
    try {
      if (hasSupabaseConfig) {
        await deleteUserAddress(user.id, address.id)
      }
      const remaining = addresses.filter((item) => item.id !== address.id)
      if (address.isDefault && remaining.length > 0) {
        remaining[0] = await persistAddress({ ...remaining[0], isDefault: true })
        remaining.forEach((item, index) => {
          if (index > 0) remaining[index] = { ...item, isDefault: false }
        })
      }
      setAddresses(remaining)
      if (!hasSupabaseConfig) {
        window.localStorage.setItem(storageKey, JSON.stringify(remaining))
      }
      setAddressMessage('Address removed.')
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : 'Unable to remove this address.')
    }
  }

  function updateAddress<K extends keyof SavedAddress>(key: K, value: SavedAddress[K]) {
    setForm((current) => key === 'state'
      ? { ...current, state: value as string, city: '' }
      : { ...current, [key]: value })
  }

  return (
    <section className="account-address-book" aria-labelledby="account-address-title">
      <div className="account-address-book__heading">
        <div>
          <p className="eyebrow">DELIVERY PREFERENCES</p>
          <h3 id="account-address-title">Saved addresses</h3>
          <p>Keep addresses for home, work, and gifting. Choose one as your default.</p>
        </div>
        {!isAdding && (
          <button type="button" className="button-ghost button-ghost--small" onClick={beginNewAddress}>
            <span className="material-symbols-outlined" aria-hidden="true">add</span>
            Add address
          </button>
        )}
      </div>

      {addressError && <p className="form-error" role="alert">{addressError}</p>}
      {addressMessage && <p className="form-notice" role="status">{addressMessage}</p>}
      {isLoading ? (
        <p className="account-address-book__loading">Loading your saved addresses…</p>
      ) : addresses.length > 0 ? (
        <div className="account-address-grid">
          {addresses.map((address) => (
            <article className={`account-address-card ${address.isDefault ? 'is-default' : ''}`} key={address.id}>
              <div className="account-address-card__top">
                <div>
                  <span className="account-address-card__label">{address.label}</span>
                  {address.isDefault && <span className="account-address-card__badge">Default</span>}
                </div>
                <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
              </div>
              <strong>{address.fullName}</strong>
              <p>{address.street}<br />{formatAddressCityState(address.city, address.state)}<br />{address.country}</p>
              <span className="account-address-card__phone">{address.phone}</span>
              <div className="account-address-card__actions">
                <button type="button" onClick={() => beginEditAddress(address)}>Edit</button>
                {!address.isDefault && <button type="button" onClick={() => void makeDefault(address)}>Make default</button>}
                <button type="button" className="is-danger" onClick={() => void removeAddress(address)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="account-address-empty">
          <span className="material-symbols-outlined" aria-hidden="true">location_on</span>
          <div>
            <strong>No saved addresses yet</strong>
            <p>Add a delivery address so it is ready for your next order.</p>
          </div>
          {!isAdding && <button type="button" className="button-ghost button-ghost--small" onClick={beginNewAddress}>Add your first address</button>}
        </div>
      )}

      {isAdding && (
        <form className="account-address-form" onSubmit={submitAddress}>
          <div className="account-address-form__heading">
            <h4>{editingId ? 'Edit address' : 'New delivery address'}</h4>
            <button type="button" className="account-address-form__close" onClick={() => setIsAdding(false)} aria-label="Cancel address editing">×</button>
          </div>
          <div className="account-settings-grid">
            <label className="field">
              <span>Address label</span>
              <input value={form.label} onChange={(event) => updateAddress('label', event.target.value)} placeholder="Home, Work, etc." required />
            </label>
            <label className="field">
              <span>Recipient name</span>
              <input value={form.fullName} onChange={(event) => updateAddress('fullName', event.target.value)} autoComplete="name" required />
            </label>
            <label className="field">
              <span>Contact number</span>
              <input type="tel" value={form.phone} onChange={(event) => updateAddress('phone', event.target.value)} autoComplete="tel" required />
            </label>
            <label className="field">
              <span>Country</span>
              <input value={form.country} onChange={(event) => updateAddress('country', event.target.value)} required />
            </label>
            <label className="field account-address-form__street">
              <span>Street address</span>
              <input value={form.street} onChange={(event) => updateAddress('street', event.target.value)} autoComplete="street-address" required />
            </label>
            <label className="field">
              <span>State</span>
              <select
                className="address-location-select"
                value={form.state}
                onChange={(event) => {
                  updateAddress('state', event.target.value)
                }}
                required
              >
                <option value="">Select a state</option>
                {nigeriaStates.map((stateName) => <option key={stateName}>{stateName}</option>)}
              </select>
            </label>
            <label className="field">
              <span>City / town</span>
              <select
                value={citySelectValue(form.state, form.city)}
                className="address-location-select"
                onChange={(event) => updateAddress('city', event.target.value)}
                autoComplete="address-level2"
                required
                disabled={!form.state}
              >
                <option value="">{form.state ? 'Select a city or town' : 'Select a state first'}</option>
                {(nigeriaCitiesByState[form.state] ?? []).map((cityName) => (
                  <option key={cityName} value={cityName}>{cityName}</option>
                ))}
                <option value={otherCityValue}>Other (enter manually)</option>
              </select>
              {(form.city === otherCityValue ||
                (Boolean(form.city) && citySelectValue(form.state, form.city) === otherCityValue)) && (
                <input
                  aria-label="Enter city or town"
                  placeholder="Enter your city or town"
                  value={form.city === otherCityValue ? '' : form.city}
                  onChange={(event) => updateAddress('city', event.target.value)}
                  autoComplete="address-level2"
                  required
                />
              )}
            </label>
          </div>
          <label className="check-row account-address-default-toggle">
            <input type="checkbox" checked={form.isDefault} onChange={(event) => updateAddress('isDefault', event.target.checked)} />
            <span>Set as my default delivery address</span>
          </label>
          <div className="account-settings-actions">
            <button type="button" className="button-ghost" onClick={() => setIsAdding(false)}>Cancel</button>
            <button type="submit" className="button-primary" disabled={isSaving}>
              {isSaving ? 'Saving address…' : editingId ? 'Save changes' : 'Add address'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function emptySavedAddress(user: SessionUser, isDefault = true): SavedAddress {
  const state = getNigeriaStateForCity(user.city)
  return {
    id: '',
    label: 'Home',
    fullName: user.name,
    phone: user.phone ?? '',
    city: state ? user.city : '',
    state,
    country: 'Nigeria',
    street: '',
    isDefault,
  }
}

function AccountOrderSummary({
  order,
  products,
  onHide,
  isHiding = false,
}: {
  order: Order
  products: Product[]
  onHide?: () => void
  isHiding?: boolean
}) {
  const firstItem = order.items[0]
  const firstProduct = products.find((product) => product.id === firstItem?.productId)
  const remainingCount = Math.max(0, order.items.reduce((count, item) => count + item.quantity, 0) - 1)

  return (
    <article className="account-order">
      <div className="account-order__top">
        <div>
          <span className="account-order__number">ORDER {order.number}</span>
          <span className="account-order__date">{formatDate(order.createdAt)}</span>
        </div>
        <span className={`status-pill status-pill--${order.status.toLowerCase()}`}>{order.status}</span>
      </div>
      <div className="account-order__main">
        {firstProduct ? (
          <SafeImage src={firstProduct.image} alt={firstProduct.name} />
        ) : (
          <span className="account-order__placeholder material-symbols-outlined" aria-hidden="true">diamond</span>
        )}
        <div className="account-order__piece">
          <strong>{firstProduct?.name ?? 'Lumina jewelry piece'}</strong>
          <span>
            {firstItem?.quantity ?? 0} {firstItem?.quantity === 1 ? 'piece' : 'pieces'}
            {remainingCount > 0 ? ` + ${remainingCount} more` : ''}
          </span>
        </div>
        <div className="account-order__total">
          <small>ORDER TOTAL</small>
          <strong>{formatNaira(order.total)}</strong>
        </div>
      </div>
      <div className="account-order__footer">
        <span>
          Payment:{' '}
          {order.status === 'Cancelled' && order.paymentStatus === 'Pending'
            ? 'Not paid · order cancelled'
            : order.paymentStatus}
        </span>
        <span>Delivering to {order.shippingCity}</span>
      </div>
      {order.status === 'Cancelled' && onHide && (
        <button
          type="button"
          className="account-order__remove"
          onClick={onHide}
          disabled={isHiding}
        >
          <span className="material-symbols-outlined" aria-hidden="true">delete_outline</span>
          {isHiding ? 'Removing…' : 'Remove from my order history'}
        </button>
      )}
    </article>
  )
}

function AccessDenied() {
  return (
    <div className="page-stack">
      <section className="page-hero">
        <p className="eyebrow">Admin access required</p>
        <h1>This studio view is protected.</h1>
        <p>
          {hasSupabaseConfig
            ? 'Please sign in with an authorized administrator account to access these administrative tools.'
            : 'Use the admin demo sign-in to enter the dashboard and inventory tools.'}
        </p>
        <LinkButton href="/login" className="button-primary">
          Go to sign in
        </LinkButton>
      </section>
    </div>
  )
}

function NotFoundPage() {
  return (
    <div className="page-stack">
      <section className="page-hero">
        <p className="eyebrow">404</p>
        <h1>That page does not exist.</h1>
        <LinkButton href="/" className="button-primary">
          Return home
        </LinkButton>
      </section>
    </div>
  )
}

function AdminLayout({ route }: { route: RouteInfo }) {
  const { state, setAdminView } = useStore()
  const activePath = route.kind

  useEffect(() => {
    if (route.kind === 'admin-dashboard') setAdminView('dashboard')
    if (route.kind === 'admin-products') setAdminView('products')
    if (route.kind === 'admin-orders') setAdminView('orders')
  }, [route.kind, setAdminView])

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar glass-card">
        <LinkButton href="/admin" className="admin-brand">
          <span className="admin-brand__mark material-symbols-outlined" aria-hidden="true">diamond</span>
          <span>
            <strong>LUMINA</strong>
            <small>ATELIER ADMIN</small>
          </span>
        </LinkButton>
        <div className="admin-sidebar__heading">
          <p className="eyebrow">Workspace</p>
          <h2>Management</h2>
        </div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <LinkButton href="/admin" className="admin-nav__link" active={activePath === 'admin-dashboard'}>
            <span className="material-symbols-outlined" aria-hidden="true">space_dashboard</span>
            Dashboard
          </LinkButton>
          <LinkButton
            href="/admin/products"
            className="admin-nav__link"
            active={activePath === 'admin-products'}
          >
            <span className="material-symbols-outlined" aria-hidden="true">diamond</span>
            Products
          </LinkButton>
          <LinkButton href="/admin/orders" className="admin-nav__link" active={activePath === 'admin-orders'}>
            <span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>
            Orders
          </LinkButton>
          <LinkButton href="/admin/inbox" className="admin-nav__link" active={activePath === 'admin-inbox'}>
            <span className="material-symbols-outlined" aria-hidden="true">mail</span>
            Inbox
            <InboxUnreadCount />
          </LinkButton>
        </nav>
        <div className="admin-sidebar__note">
          <span className="admin-avatar" aria-hidden="true">{initials(state.user?.name ?? 'Admin')}</span>
          <span className="admin-sidebar__identity">
            <strong>{state.user?.name}</strong>
            <small>{state.user?.email}</small>
          </span>
        </div>
        <LinkButton href="/" className="admin-store-link">
          <span className="material-symbols-outlined" aria-hidden="true">storefront</span>
          View storefront
          <span className="material-symbols-outlined admin-store-link__arrow" aria-hidden="true">arrow_outward</span>
        </LinkButton>
        <div className="admin-sidebar__status">
          <span className="admin-status-dot" />
          {hasSupabaseConfig ? 'Supabase connected' : 'Local demo mode'}
        </div>
      </aside>

      <main className="admin-content">
        {hasSupabaseConfig ? (
          <>
            {route.kind === 'admin-dashboard' && <AdminDashboardPage />}
            {route.kind === 'admin-products' && <AdminProductsPage route={route} />}
            {route.kind === 'admin-orders' && <AdminOrdersPage />}
            {route.kind === 'admin-inbox' && <AdminInboxPage />}
          </>
        ) : (
          <section className="page-hero">
            <p className="eyebrow">Connect a live database</p>
            <h1>Connect Supabase to manage your store.</h1>
            <p>
              The local demo catalog is intentionally hidden from the admin workspace.
              Configure the Supabase URL and anon key to view real customer orders,
              messages, and products here. Demo products and orders are never shown as
              real store activity.
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

function AdminInboxPage() {
  const { state } = useStore()
  const user = state.user
  const [conversations, setConversations] = useState<SupportConversation[]>([])
  const [notifications, setNotifications] = useState<InboxNotification[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    const refresh = async () => {
      try {
        const [conversationRows, notificationRows] = await Promise.all([
          fetchSupportConversations(),
          fetchInboxNotifications(),
        ])
        if (isCurrent) {
          setConversations(conversationRows)
          setNotifications(notificationRows)
          setSelectedConversationId((selected) =>
            conversationRows.some((conversation) => conversation.id === selected)
              ? selected
              : conversationRows[0]?.id ?? '',
          )
          setError(null)
        }
      } catch (refreshError) {
        if (isCurrent) setError(getMessagingErrorMessage(refreshError))
      } finally {
        if (isCurrent) setIsLoading(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30000)
    return () => {
      isCurrent = false
      window.clearInterval(interval)
    }
  }, [])

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  )

  async function openAdminNotification(notification: InboxNotification) {
    try {
      if (!notification.readAt) await markInboxNotificationRead(notification.id)
      setNotifications((current) => current.map((entry) =>
        entry.id === notification.id ? { ...entry, readAt: new Date().toISOString() } : entry,
      ))
      if (notification.conversationId) setSelectedConversationId(notification.conversationId)
    } catch (notificationError) {
      setError(getMessagingErrorMessage(notificationError))
    }
  }

  if (!user) return null

  return (
    <section className="admin-inbox-page" aria-labelledby="admin-inbox-title">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">CUSTOMER CARE</p>
          <h1 id="admin-inbox-title">Support inbox</h1>
          <p>Read customer messages and reply directly from the atelier.</p>
        </div>
        <LinkButton href="/" className="button-ghost button-ghost--small">View storefront</LinkButton>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="admin-inbox-grid">
        <aside className="admin-inbox-sidebar">
          <section className="inbox-panel">
            <div className="inbox-panel__heading">
              <div>
                <p className="eyebrow">NEW ACTIVITY</p>
                <h2>Notifications</h2>
              </div>
              <span className="inbox-panel__count">{notifications.filter((item) => !item.readAt).length}</span>
            </div>
            {notifications.filter((item) => item.type === 'support').length ? (
              <div className="inbox-notification-list">
                {notifications.filter((item) => item.type === 'support').slice(0, 20).map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    className={`inbox-notification${notification.readAt ? '' : ' is-unread'}`}
                    onClick={() => void openAdminNotification(notification)}
                  >
                    <span className="inbox-notification__icon material-symbols-outlined" aria-hidden="true">support_agent</span>
                    <span className="inbox-notification__copy">
                      <strong>{notification.title}</strong>
                      <span>{notification.message}</span>
                      <small>{new Date(notification.createdAt).toLocaleString()}</small>
                    </span>
                    {!notification.readAt && <span className="inbox-notification__dot" aria-label="Unread" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="inbox-empty">{isLoading ? 'Loading notifications…' : 'No support notifications yet.'}</p>
            )}
          </section>
          <section className="inbox-panel">
            <div className="inbox-panel__heading">
              <div>
                <p className="eyebrow">CONVERSATIONS</p>
                <h2>Customers</h2>
              </div>
              <span className="inbox-panel__count">{conversations.length}</span>
            </div>
            {conversations.length ? (
              <div className="admin-conversation-list">
                {conversations.map((conversation) => (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`admin-conversation${selectedConversationId === conversation.id ? ' is-active' : ''}`}
                    onClick={() => setSelectedConversationId(conversation.id)}
                  >
                    <span className="admin-conversation__avatar">{initials(conversation.customerName)}</span>
                    <span>
                      <strong>{conversation.customerName}</strong>
                      <small>{conversation.customerEmail}</small>
                      <small>{new Date(conversation.updatedAt).toLocaleString()}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="inbox-empty">{isLoading ? 'Loading conversations…' : 'Customer conversations will appear here.'}</p>
            )}
          </section>
        </aside>
        <section className="inbox-panel admin-inbox-thread" aria-label="Selected support conversation">
          {selectedConversation ? (
            <>
              <div className="inbox-panel__heading">
                <div>
                  <p className="eyebrow">CUSTOMER CONVERSATION</p>
                  <h2>{selectedConversation.customerName}</h2>
                  <p>{selectedConversation.customerEmail}</p>
                </div>
              </div>
              <SupportThread
                key={selectedConversation.id}
                user={user}
                conversationId={selectedConversation.id}
              />
            </>
          ) : (
            <div className="inbox-empty admin-inbox-thread__empty">
              <span className="material-symbols-outlined" aria-hidden="true">forum</span>
              <strong>Select a customer conversation</strong>
              <span>Choose a customer from the list to read and reply.</span>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

function AdminDashboardPage() {
  const { state } = useStore()
  const paidOrders = state.orders.filter((order) => order.paymentStatus === 'Paid')
  const totalRevenue = paidOrders.reduce((sum, order) => sum + order.total, 0)
  const processing = state.orders.filter((order) => order.status === 'Processing').length
  const activeProducts = state.products.filter((product) => product.status === 'Active').length
  const avgOrder = paidOrders.length > 0 ? Math.round(totalRevenue / paidOrders.length) : 0
  const recentOrders = state.orders
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 4)
  const today = new Date()
  const revenueByDay = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setHours(0, 0, 0, 0)
    date.setDate(today.getDate() - (6 - index))
    const revenue = paidOrders.reduce((sum, order) => {
      const orderDate = new Date(order.createdAt)
      return orderDate.toDateString() === date.toDateString() ? sum + order.total : sum
    }, 0)
    return { date, revenue }
  })
  const maxDailyRevenue = Math.max(...revenueByDay.map((day) => day.revenue), 0)

  const topPieces = state.products
    .slice()
    .sort((left, right) => right.rating - left.rating)
    .slice(0, 3)

  return (
    <div className="page-stack">
      <section className="admin-welcome">
        <div>
          <p className="eyebrow">ATELIER OVERVIEW</p>
          <h1>Good day, {state.user?.name.split(' ')[0] ?? 'Admin'}.</h1>
          <p>Here is the latest view of your orders and collection.</p>
        </div>
        <div className="admin-welcome__actions">
          <span className="admin-date">
            <span className="material-symbols-outlined" aria-hidden="true">calendar_today</span>
            {new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' }).format(today)}
          </span>
          <LinkButton href="/admin/products?mode=new" className="button-primary">
            <span className="material-symbols-outlined" aria-hidden="true">add</span>
            Add product
          </LinkButton>
        </div>
      </section>

      <section className="admin-metrics" aria-label="Store performance">
        <article className="glass-card admin-metric">
          <div className="admin-metric__top">
            <span>Total orders</span>
            <span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>
          </div>
          <strong>{state.orders.length}</strong>
          <small>Across all order statuses</small>
        </article>
        <article className="glass-card admin-metric">
          <div className="admin-metric__top">
            <span>Paid revenue</span>
            <span className="material-symbols-outlined" aria-hidden="true">payments</span>
          </div>
          <strong>{formatNaira(totalRevenue)}</strong>
          <small>From {paidOrders.length} paid {paidOrders.length === 1 ? 'order' : 'orders'}</small>
        </article>
        <article className="glass-card admin-metric">
          <div className="admin-metric__top">
            <span>In progress</span>
            <span className="material-symbols-outlined" aria-hidden="true">pending_actions</span>
          </div>
          <strong>{processing}</strong>
          <small>Orders awaiting fulfillment</small>
        </article>
        <article className="glass-card admin-metric">
          <div className="admin-metric__top">
            <span>Active pieces</span>
            <span className="material-symbols-outlined" aria-hidden="true">diamond</span>
          </div>
          <strong>{activeProducts}</strong>
          <small>Available in your collection</small>
        </article>
      </section>

      <section className="admin-chart glass-card">
        <div className="admin-section-heading">
          <div>
            <p className="eyebrow">SALES PERFORMANCE</p>
            <h2>Paid revenue</h2>
          </div>
          <span className="admin-chart__range">Last 7 days</span>
        </div>
        {maxDailyRevenue > 0 ? (
          <div className="admin-revenue-chart" role="img" aria-label="Paid revenue by day for the last seven days">
            {revenueByDay.map(({ date, revenue }) => (
              <div className="admin-revenue-chart__day" key={date.toISOString()}>
                <strong>{revenue > 0 ? formatNaira(revenue) : ''}</strong>
                <span className="admin-revenue-chart__track">
                  <span
                    className="admin-revenue-chart__bar"
                    style={{ height: `${revenue > 0 ? Math.max(8, (revenue / maxDailyRevenue) * 100) : 0}%` }}
                  />
                </span>
                <small>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-chart__empty">
            <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
            <span>No paid revenue recorded in the last seven days.</span>
          </div>
        )}
        <p className="admin-chart__footnote">Average paid order: <strong>{formatNaira(avgOrder)}</strong></p>
      </section>

      <section className="admin-dashboard-grid">
        <article className="glass-card admin-list admin-dashboard-panel">
          <div className="admin-section-heading">
            <div>
              <p className="eyebrow">COLLECTION</p>
              <h2>Top-rated pieces</h2>
            </div>
            <LinkButton href="/admin/products" className="admin-inline-link">Manage products <span aria-hidden="true">→</span></LinkButton>
          </div>
          <div className="admin-dashboard-list">
            {topPieces.map((product) => (
              <div key={product.id} className="admin-featured-product">
                <SafeImage src={product.image} alt="" />
                <div className="admin-featured-product__copy">
                  <strong>{product.name}</strong>
                  <span>{product.category} · {formatNaira(product.price)}</span>
                </div>
                <span className="admin-rating">
                  <span className="material-symbols-outlined" aria-hidden="true">star</span>
                  {product.rating.toFixed(1)}
                </span>
                <LinkButton
                  href={`/admin/products?product=${encodeURIComponent(product.id)}`}
                  className="admin-edit-link"
                  aria-label={`Edit ${product.name}`}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                </LinkButton>
              </div>
            ))}
            {topPieces.length === 0 && <p className="admin-empty-note">Add a product to start building your collection.</p>}
          </div>
        </article>

        <article className="glass-card admin-list admin-dashboard-panel">
          <div className="admin-section-heading">
            <div>
              <p className="eyebrow">FULFILLMENT</p>
              <h2>Recent orders</h2>
            </div>
            <LinkButton href="/admin/orders" className="admin-inline-link">All orders <span aria-hidden="true">→</span></LinkButton>
          </div>
          <div className="admin-dashboard-list">
            {recentOrders.map((order) => (
              <div key={order.id} className="admin-recent-order">
                <div className="admin-recent-order__identity">
                  <strong>{order.number}</strong>
                  <span>{order.customerName} · {formatDate(order.createdAt)}</span>
                </div>
                <span className={`status-pill status-pill--${order.status.toLowerCase()}`}>{order.status}</span>
                <strong className="admin-recent-order__total">{formatNaira(order.total)}</strong>
              </div>
            ))}
            {recentOrders.length === 0 && (
              <div className="admin-empty-note">
                <span className="material-symbols-outlined" aria-hidden="true">inbox</span>
                <span>New orders will appear here.</span>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  )
}

const ACCENT_PRESETS = [
  { name: 'Classic Gold', value: 'linear-gradient(135deg, #120f0b 0%, #5f4b22 50%, #c8a44d 100%)' },
  { name: 'Rose Gold', value: 'linear-gradient(135deg, #161011 0%, #7c585d 50%, #e0b0b6 100%)' },
  { name: 'Platinum', value: 'linear-gradient(135deg, #0e1111 0%, #565d5e 50%, #d1d5db 100%)' },
  { name: 'Emerald', value: 'linear-gradient(135deg, #051510 0%, #1e5c4d 50%, #50c878 100%)' },
  { name: 'Sapphire', value: 'linear-gradient(135deg, #050b18 0%, #1c3b7a 50%, #4a8bf5 100%)' },
]

function AdminProductsPage({ route }: { route: RouteInfo }) {
  const { state, upsertProduct, deleteProduct } = useStore()
  const requestedProductId = route.query.get('product') ?? ''
  const requestedMode = route.query.get('mode')
  const initialProduct =
    state.products.find((product) => product.id === requestedProductId) ?? state.products[0]
  const [selectedId, setSelectedId] = useState(requestedMode === 'new' ? '' : initialProduct?.id ?? '')
  const [isCreating, setIsCreating] = useState(requestedMode === 'new')
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const selectedProduct = state.products.find((product) => product.id === selectedId)
  const [form, setForm] = useState<ProductFormState>(() =>
    requestedMode === 'new' || !initialProduct ? emptyProductForm() : productToForm(initialProduct),
  )

  const [isDraggingImages, setIsDraggingImages] = useState(false)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)

  const productImageList = [
    form.image,
    ...form.gallery.split(',').map((img) => img.trim()).filter(Boolean),
  ].filter(Boolean)

  async function handleImageFiles(files: FileList) {
    setImageUploadError(null)
    const newImages: string[] = []
    const currentLength = productImageList.length
    const allowedNew = 4 - currentLength
    if (allowedNew <= 0) {
      setImageUploadError('Maximum of 4 images allowed.')
      return
    }

    const filesToProcess = Array.from(files).slice(0, allowedNew)

    for (const file of filesToProcess) {
      if (!file.type.startsWith('image/')) {
        setImageUploadError('Only image files are allowed.')
        continue
      }

      try {
        const base64 = await fileToBase64(file)
        newImages.push(base64)
      } catch {
        setImageUploadError('Failed to read image file.')
      }
    }

    if (newImages.length > 0) {
      setForm((current) => {
        const list = [...productImageList, ...newImages]
        const [newImage, ...newGallery] = list
        return {
          ...current,
          image: newImage ?? '',
          gallery: newGallery.join(', '),
        }
      })
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = (error) => reject(error)
      reader.readAsDataURL(file)
    })
  }

  function removeProductImage(index: number) {
    const list = [...productImageList]
    list.splice(index, 1)

    const [newImage, ...newGallery] = list
    setForm((current) => ({
      ...current,
      image: newImage ?? '',
      gallery: newGallery.join(', '),
    }))
  }

  function setPrimaryImage(index: number) {
    if (index === 0) return
    const list = [...productImageList]
    const temp = list[0]
    list[0] = list[index]
    list[index] = temp

    const [newImage, ...newGallery] = list
    setForm((current) => ({
      ...current,
      image: newImage ?? '',
      gallery: newGallery.join(', '),
    }))
  }

  useEffect(() => {
    if (requestedMode === 'new') {
      startNewProduct(false)
      return
    }

    if (!requestedProductId) {
      return
    }

    const requestedProduct = state.products.find((product) => product.id === requestedProductId)
    if (requestedProduct) {
      selectProduct(requestedProduct, false)
    }
  }, [requestedMode, requestedProductId, state.products])

  function updateField<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'name' && isCreating) {
        next.slug = slugify(value as string)
      }
      return next
    })
  }

  function startNewProduct(updateUrl = true) {
    setIsCreating(true)
    setSelectedId('')
    setForm(emptyProductForm())
    setSaveMessage(null)
    setSaveError(null)
    if (updateUrl) {
      navigate('/admin/products?mode=new')
    }
  }

  function selectProduct(product: Product, updateUrl = true) {
    setIsCreating(false)
    setSelectedId(product.id)
    setForm(productToForm(product))
    setSaveMessage(null)
    setSaveError(null)
    if (updateUrl) {
      navigate(`/admin/products?product=${encodeURIComponent(product.id)}`)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setSaveMessage(null)
    setSaveError(null)

    try {
      const saved = await upsertProduct(form)
      setIsCreating(false)
      setSelectedId(saved.id)
      setForm(productToForm(saved))
      setSaveMessage(hasSupabaseConfig ? 'Product saved to Supabase.' : 'Product saved locally.')
    } catch (submitError) {
      setSaveError(
        submitError instanceof Error ? submitError.message : 'Unable to save this product.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function removeSelectedProduct() {
    if (!selectedProduct || isDeleting) return
    const confirmed = window.confirm(
      `Delete "${selectedProduct.name}" from the catalog? This cannot be undone. Past order details will be retained.`,
    )
    if (!confirmed) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteProduct(selectedProduct.id)
      setIsCreating(true)
      setSelectedId('')
      setForm(emptyProductForm())
      navigate('/admin/products?mode=new')
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete this product.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="page-hero page-hero--compact">
        <p className="eyebrow">Inventory management</p>
        <h1>Product management</h1>
        <p>
          Add new pieces or edit pricing, copy, and merchandising flags.
          {hasSupabaseConfig ? ' Changes sync to Supabase when you save.' : ' Running in local demo mode.'}
        </p>
        <div className="admin-action-bar">
          <button type="button" className="button-primary" onClick={() => startNewProduct()}>
            Add product
          </button>
          {selectedProduct && !isCreating && (
            <button
              type="button"
              className="button-ghost admin-delete-product-button"
              onClick={() => void removeSelectedProduct()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete product'}
            </button>
          )}
          {selectedProduct && !isCreating && (
            <LinkButton href={`/product/${selectedProduct.slug}`} className="button-ghost">
              View product
            </LinkButton>
          )}
          <LinkButton href="/admin/orders" className="button-ghost">
            View orders
          </LinkButton>
        </div>
      </section>

      {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
      <div className="admin-product-workspace">
        <article className="glass-card admin-list admin-list--scroll">
          <div className="admin-panel-heading">
            <div>
              <p className="eyebrow">Catalog</p>
              <h2>Manage products</h2>
            </div>
            <button
              type="button"
              className="button-primary button-primary--small"
              onClick={() => startNewProduct()}
            >
              New
            </button>
          </div>
          {state.products.map((product) => (
            <button
              key={product.id}
              type="button"
              className={`admin-product-row ${selectedId === product.id && !isCreating ? 'is-active' : ''}`}
              onClick={() => selectProduct(product)}
            >
              <div className="admin-row__visual" style={{ background: product.accent }} />
              <div>
                <strong>{product.name}</strong>
                <span>{product.category}</span>
              </div>
              <span>Edit</span>
            </button>
          ))}
        </article>

        <form className="glass-card admin-form" onSubmit={submit}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">{isCreating ? 'New product' : 'Edit product'}</p>
              <h2>{form.name || 'New product'}</h2>
            </div>
            <button type="submit" className="button-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : isCreating ? 'Create product' : 'Update product'}
            </button>
          </div>
          {saveMessage && <p className="form-notice">{saveMessage}</p>}
          {saveError && <p className="form-error">{saveError}</p>}
          <div className="form-grid">
            <label className="field">
              <span>Name *</span>
              <input
                required
                value={form.name}
                placeholder="e.g., Aurelia Diamond Band"
                onChange={(event) => updateField('name', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Slug * (Auto-generated)</span>
              <input
                required
                value={form.slug}
                placeholder="e.g., aurelia-diamond-band"
                onChange={(event) => updateField('slug', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Category *</span>
              <select
                value={form.category}
                onChange={(event) => updateField('category', event.target.value as ProductFormState['category'])}
              >
                {['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Watches'].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div className="field admin-image-field">
              <span>Product images *</span>
              <label
                className={`image-dropzone ${isDraggingImages ? 'is-dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDraggingImages(true)
                }}
                onDragLeave={() => setIsDraggingImages(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDraggingImages(false)
                  void handleImageFiles(event.dataTransfer.files)
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    if (event.target.files) {
                      void handleImageFiles(event.target.files)
                      event.target.value = ''
                    }
                  }}
                />
                <span className="material-symbols-outlined">add_photo_alternate</span>
                <strong>Drop images here or choose files</strong>
                <small>Up to 4 images. First image is the main product image.</small>
              </label>
              {imageUploadError && <p className="form-error">{imageUploadError}</p>}
              {productImageList.length > 0 && (
                <div className="image-preview-grid">
                  {productImageList.map((image, index) => (
                    <article key={`${image}-${index}`} className="image-preview-card">
                      <SafeImage src={image} alt={`Product image ${index + 1}`} />
                      <div className="image-preview-card__actions">
                        <button
                          type="button"
                          className="button-ghost button-ghost--small"
                          disabled={index === 0}
                          onClick={() => setPrimaryImage(index)}
                        >
                          {index === 0 ? 'Main' : 'Set main'}
                        </button>
                        <button
                          type="button"
                          className="button-ghost button-ghost--small"
                          onClick={() => removeProductImage(index)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <input
                required
                type={form.image.startsWith('data:') ? 'text' : 'url'}
                value={form.image}
                placeholder="Or paste a main image URL"
                onChange={(event) => updateField('image', event.target.value)}
              />
            </div>
            <label className="field">
              <span>Price (Required, in ₦) *</span>
              <input
                required
                type="number"
                min="0"
                value={form.price}
                placeholder="e.g., 450000"
                onChange={(event) => updateField('price', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Compare at Price (Optional, in ₦)</span>
              <input
                type="number"
                min="0"
                value={form.compareAtPrice}
                placeholder="e.g., 550000"
                onChange={(event) => updateField('compareAtPrice', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Rating (Optional, 1.0 - 5.0)</span>
              <input
                value={form.rating}
                placeholder="e.g., 4.9 (defaults to 4.8)"
                onChange={(event) => updateField('rating', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Badge (Optional)</span>
              <input
                value={form.badge}
                placeholder="e.g., New Season / Bespoke"
                onChange={(event) => updateField('badge', event.target.value)}
              />
            </label>
            <label className="field">
              <span>Status *</span>
              <select
                value={form.status}
                onChange={(event) => updateField('status', event.target.value as ProductFormState['status'])}
              >
                <option value="Active">Active</option>
                <option value="Draft">Draft</option>
                <option value="Archived">Archived</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Material (Optional)</span>
            <input
              value={form.material}
              placeholder="e.g., 18k Yellow Gold / Platinum"
              onChange={(event) => updateField('material', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Gemstone (Optional)</span>
            <input
              value={form.gemstone}
              placeholder="e.g., VVS Round Brilliant Diamonds"
              onChange={(event) => updateField('gemstone', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Description (Optional summary)</span>
            <textarea
              rows={4}
              value={form.description}
              placeholder="Provide a compelling customer-facing summary of this piece..."
              onChange={(event) => updateField('description', event.target.value)}
            />
          </label>
          <label className="field">
            <span>The Story (Optional craftsmanship note)</span>
            <textarea
              rows={4}
              value={form.story}
              placeholder="Detail the craftsmanship, origin, heritage, or design inspiration behind this piece..."
              onChange={(event) => updateField('story', event.target.value)}
            />
          </label>
          <div className="inline-row">
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) => updateField('featured', event.target.checked)}
              />
              <span>Featured product</span>
            </label>
            <label className="field field--small">
              <span>Accent (Optional gradient)</span>
              <input
                value={form.accent}
                placeholder="e.g., linear-gradient(...)"
                onChange={(event) => updateField('accent', event.target.value)}
              />
            </label>
          </div>
          <div className="field" style={{ width: '100%', marginTop: '0.25rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.5rem', display: 'block' }}>Accent Gradient Presets</span>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.name}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: preset.value,
                    border: form.accent === preset.value ? '2px solid var(--gold)' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'transform 0.15s ease, border-color 0.15s ease',
                  }}
                  onClick={() => updateField('accent', preset.value)}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                />
              ))}
            </div>
          </div>
        </form>

      </div>
    </div>
  )
}

function AdminOrdersPage() {
  const { state, updateOrderStatus } = useStore()
  const [filter, setFilter] = useState<'All' | OrderStatus>('All')
  const orders = state.orders.filter((order) => filter === 'All' || order.status === filter)

  return (
    <div className="page-stack">
      <section className="page-hero page-hero--compact">
        <p className="eyebrow">Order management</p>
        <h1>Order vault</h1>
        <p>New orders start as Processing. Accept an order to move it into Crafting; customers see status changes in their account.</p>
      </section>

      <div className="glass-card table-card">
        <div className="table-toolbar">
          <span>{orders.length} orders</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="All">All</option>
            <option value="Processing">Processing</option>
            <option value="Crafting">Crafting</option>
            <option value="Shipped">Shipped</option>
            <option value="Delivered">Delivered</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Client</th>
                <th>City</th>
                <th>Date</th>
                <th>Status</th>
                <th>Total</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7}>No orders yet. Customer orders placed through this connected Supabase project will appear here.</td>
                </tr>
              )}
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.number}</td>
                  <td>{order.customerName}</td>
                  <td>{order.shippingCity}</td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>
                    <span className={`status-pill status-pill--${order.status.toLowerCase()}`}>
                      {order.status}
                    </span>
                  </td>
                  <td>{formatNaira(order.total)}</td>
                  <td>
                    {order.status === 'Processing' && (
                      <button
                        type="button"
                        className="button-ghost button-ghost--small"
                        onClick={() => void updateOrderStatus(order.id, 'Crafting')}
                      >
                        Accept order
                      </button>
                    )}
                    <select
                      value={order.status}
                      onChange={(event) =>
                        updateOrderStatus(order.id, event.target.value as OrderStatus)
                      }
                    >
                      <option value="Processing">Processing</option>
                      <option value="Crafting">Crafting</option>
                      <option value="Shipped">Shipped</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SafeImage({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  const currentSrc = failedSources.includes(src) ? productImageFallback : src

  return (
    <img
      className={className}
      src={currentSrc}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (src !== productImageFallback) {
          setFailedSources((current) => current.includes(src) ? current : [...current, src])
        }
      }}
    />
  )
}

function ProductCard({
  product,
  onQuickAdd,
  onWishlist,
  onQuickView,
}: {
  product: Product
  onQuickAdd: () => void
  onWishlist: () => void
  onQuickView: () => void
}) {
  const { state } = useStore()
  const isAdmin = state.user?.role === 'admin'
  const wishlisted = state.wishlist.includes(product.id)

  return (
    <article className="glass-card product-card">
      <button
        type="button"
        className="product-card__visual"
        onClick={onQuickView}
      >
        <SafeImage className="product-card__photo" src={product.image} alt={product.name} />
        <span className="hero-visual__label">{product.badge ?? product.category}</span>
      </button>
      <div className="product-card__copy">
        <div className="product-card__top">
          <div>
            <h3>{product.name}</h3>
            <p>{product.material}</p>
          </div>
          {!isAdmin && (
            <button
              type="button"
              className={`wishlist-button ${wishlisted ? 'is-active' : ''}`}
              onClick={onWishlist}
              aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
            >
              <span className="material-symbols-outlined" aria-hidden="true">favorite</span>
            </button>
          )}
        </div>
        <div className="product-card__meta">
          <strong>{formatNaira(product.price)}</strong>
          {product.compareAtPrice && <span>{formatNaira(product.compareAtPrice)}</span>}
        </div>
        <p className="product-card__description">{product.description}</p>
        <div className="product-card__actions">
          {isAdmin ? (
            <LinkButton
              href={`/admin/products?product=${encodeURIComponent(product.id)}`}
              className="button-primary button-primary--small"
            >
              Edit product
            </LinkButton>
          ) : (
            <button type="button" className="button-primary button-primary--small" onClick={onQuickAdd}>
              Quick add
            </button>
          )}
          <LinkButton href={`/product/${product.slug}`} className="button-ghost button-ghost--small">
            View piece
          </LinkButton>
        </div>
      </div>
    </article>
  )
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string
  title: string
  text?: string
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {text && <p className="section-heading__text">{text}</p>}
    </div>
  )
}

function QuickViewModal({
  product,
  onClose,
}: {
  product: Product
  onClose: () => void
}) {
  const { addToCart, toggleWishlist, state } = useStore()
  const isAdmin = state.user?.role === 'admin'
  const [activeIndex, setActiveIndex] = useState(0)
  const gallery = [product.image, ...(product.gallery ?? [])].slice(0, 5)
  const wishlisted = state.wishlist.includes(product.id)

  function moveCarousel(direction: -1 | 1) {
    setActiveIndex((current) => {
      if (!gallery.length) {
        return 0
      }

      return (current + direction + gallery.length) % gallery.length
    })
  }

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card glass-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-media">
          <div className="modal-carousel">
            <div className="modal-carousel__viewport">
              <button
                type="button"
                className="modal-carousel__nav modal-carousel__nav--prev"
                onClick={() => moveCarousel(-1)}
                aria-label="Previous image"
              >
                ←
              </button>
              <SafeImage src={gallery[activeIndex] ?? product.image} alt={product.name} />
              <button
                type="button"
                className="modal-carousel__nav modal-carousel__nav--next"
                onClick={() => moveCarousel(1)}
                aria-label="Next image"
              >
                →
              </button>
            </div>
            <div className="modal-carousel__dots" aria-label="Product images">
              {gallery.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  className={activeIndex === index ? 'is-active' : ''}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Show image ${index + 1} of ${gallery.length}`}
                />
              ))}
            </div>
          </div>
          <div className="modal-thumbs">
            {gallery.map((image, index) => (
              <button
                key={image}
                type="button"
                className={activeIndex === index ? 'is-active' : ''}
                onClick={() => setActiveIndex(index)}
                aria-label={`View image thumbnail ${index + 1}`}
              >
                <SafeImage src={image} alt="" />
              </button>
            ))}
          </div>
        </div>
        <div className="modal-copy">
          <div className="modal-copy__top">
            <p className="eyebrow">{product.category}</p>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close modal"
            >
              ×
            </button>
          </div>
          <h2>{product.name}</h2>
          <p>{product.description}</p>
          <div className="price-row">
            <strong>{formatNaira(product.price)}</strong>
            {product.compareAtPrice && <span>{formatNaira(product.compareAtPrice)}</span>}
          </div>
          <div className="detail-pills">
            <span>{product.material}</span>
            <span>{product.gemstone}</span>
          </div>
          <div className="hero-actions">
            {isAdmin ? (
              <LinkButton
                href={`/admin/products?product=${encodeURIComponent(product.id)}`}
                className="button-primary"
              >
                Edit product
              </LinkButton>
            ) : (
              <>
                <button type="button" className="button-primary" onClick={() => addToCart(product.id)}>
                  Add to bag
                </button>
                <button type="button" className={`button-ghost ${wishlisted ? 'is-active' : ''}`} onClick={() => toggleWishlist(product.id)}>
                  {wishlisted ? 'Saved' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function productToForm(product: Product): ProductFormState {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category,
    image: product.image,
    price: String(product.price),
    compareAtPrice: product.compareAtPrice ? String(product.compareAtPrice) : '',
    badge: product.badge ?? '',
    gemstone: product.gemstone,
    material: product.material,
    description: product.description,
    story: product.story,
    rating: String(product.rating),
    featured: product.featured,
    status: product.status,
    accent: product.accent,
    gallery: product.gallery ? product.gallery.join(', ') : '',
  }
}

export default App
