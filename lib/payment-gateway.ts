import type { PaymentProvider, Prisma } from "@prisma/client";

export type DepositCheckoutInput = {
  userId: string;
  depositId: string;
  amount: Prisma.Decimal;
  currency: "USD";
  idempotencyKey: string;
  returnUrl: string;
};

export type DepositCheckoutResult = {
  providerReference: string;
  checkoutUrl: string;
  expiresAt?: Date;
};

export type WithdrawalPayoutInput = {
  userId: string;
  withdrawalId: string;
  amount: Prisma.Decimal;
  currency: "USD";
  destination: string;
  idempotencyKey: string;
};

export type WithdrawalPayoutResult = {
  providerReference: string;
  providerTxId?: string;
};

export interface PaymentGatewayAdapter {
  provider: PaymentProvider;
  createDepositCheckout(input: DepositCheckoutInput): Promise<DepositCheckoutResult>;
  createWithdrawal(input: WithdrawalPayoutInput): Promise<WithdrawalPayoutResult>;
}

// Intentionally empty until we select and contract with a real payment provider.
// Production code must never treat environment flags alone as a working gateway.
const adapters: Partial<Record<PaymentProvider, PaymentGatewayAdapter>> = {};

export function getConfiguredPaymentProvider(): PaymentProvider | null {
  const raw = String(process.env.DUELPLAY_PAYMENT_PROVIDER || "").trim().toUpperCase();
  return raw && raw in adapters ? raw as PaymentProvider : null;
}

export function getPaymentGateway(provider: PaymentProvider | null = getConfiguredPaymentProvider()) {
  return provider ? adapters[provider] ?? null : null;
}

export function isPaymentGatewayConfigured() {
  if (process.env.NODE_ENV !== "production" && process.env.DUELPLAY_LOCAL_TEST_MODE !== "false") return true;
  const provider = getConfiguredPaymentProvider();
  return Boolean(provider && getPaymentGateway(provider) && process.env.DUELPLAY_PAYMENT_WEBHOOK_SECRET);
}
