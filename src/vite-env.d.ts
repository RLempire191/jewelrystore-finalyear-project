/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_PAYSTACK_PUBLIC_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '@paystack/inline-js' {
  interface PaystackTransaction {
    id?: number
    reference?: string
    message?: string
  }

  interface PaystackTransactionOptions {
    key: string
    email: string
    amount: number
    currency?: string
    reference?: string
    firstName?: string
    lastName?: string
    phone?: string
    metadata?: Record<string, unknown>
    onSuccess?: (transaction: PaystackTransaction) => void
    onCancel?: () => void
    onError?: (error: { message: string }) => void
    onLoad?: (payload: { id: number; accessCode: string }) => void
  }

  export default class PaystackPop {
    newTransaction(options: PaystackTransactionOptions): unknown
    static isLoaded(): boolean
  }
}
