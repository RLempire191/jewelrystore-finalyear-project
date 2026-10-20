import PaystackPop from '@paystack/inline-js'

export const paystackPublicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY?.trim() ?? ''

export const hasPaystackConfig = paystackPublicKey.length > 0

export interface PaystackPaymentInput {
  email: string
  amountKobo: number
  reference: string
  name?: string
  phone?: string
  metadata?: Record<string, string>
}

export interface PaystackPaymentResult {
  reference: string
  transactionId?: string
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  }
}

export function createPaystackReference() {
  return `LM-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function preloadPaystackCheckout() {
  if (!hasPaystackConfig || PaystackPop.isLoaded()) {
    return
  }

  new PaystackPop()
}

export function initiatePaystackPayment(
  input: PaystackPaymentInput,
): Promise<PaystackPaymentResult> {
  if (!hasPaystackConfig) {
    return Promise.reject(new Error('Paystack public key is not configured.'))
  }

  const { firstName, lastName } = splitName(input.name ?? '')

  return new Promise((resolve, reject) => {
    const paystack = new PaystackPop()

    paystack.newTransaction({
      key: paystackPublicKey,
      email: input.email.trim(),
      amount: input.amountKobo,
      currency: 'NGN',
      reference: input.reference,
      firstName,
      lastName,
      phone: input.phone?.trim(),
      metadata: {
        custom_fields: [
          {
            display_name: 'Customer',
            variable_name: 'customer_name',
            value: input.name ?? '',
          },
          {
            display_name: 'Phone',
            variable_name: 'phone',
            value: input.phone ?? '',
          },
        ],
        ...input.metadata,
      },
      onSuccess: (transaction) => {
        resolve({
          reference: transaction.reference ?? input.reference,
          transactionId: transaction.id ? String(transaction.id) : undefined,
        })
      },
      onCancel: () => {
        reject(new Error('Payment cancelled.'))
      },
      onError: (error) => {
        reject(new Error(error.message || 'Paystack could not start this payment.'))
      },
    })
  })
}

export function canStartPaystack(form: {
  fullName: string
  email: string
  phone: string
}) {
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  return form.fullName.trim().length >= 2 && emailValid && form.phone.trim().length >= 7
}

export async function simulatePaystackPayment(reference: string): Promise<PaystackPaymentResult> {
  await new Promise((resolve) => window.setTimeout(resolve, 900))
  return { reference, transactionId: `demo-${Date.now()}` }
}
