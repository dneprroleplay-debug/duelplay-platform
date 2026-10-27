export type RecoveryNoticePolicyInput = {
  emailConfirmed: boolean;
  status: string;
  realBalance: string | number;
  sourceLedgerMatches: boolean;
  holdLedgerMatches: boolean;
  oldAccountAnonymized: boolean;
  oldWalletZero: boolean;
  laterLedgerCount: number;
};

export function isRecoveryNoticeEligible(input: RecoveryNoticePolicyInput) {
  const amount = Number(input.realBalance);
  return input.emailConfirmed
    && input.status === "AVAILABLE"
    && Number.isFinite(amount) && amount > 0
    && input.sourceLedgerMatches
    && input.holdLedgerMatches
    && input.oldAccountAnonymized
    && input.oldWalletZero
    && input.laterLedgerCount === 0;
}

export type RecoveryIdentityPolicyInput = {
  emailHmacMatches: boolean;
  steamHmacMatches: boolean;
  emailConfirmed: boolean;
  activeNewAccount: boolean;
  isDifferentInternalAccount: boolean;
  recoveryAvailable: boolean;
  ledgerVerified: boolean;
};

export function isRecoveryRestoreEligible(input: RecoveryIdentityPolicyInput) {
  return input.emailHmacMatches
    && input.steamHmacMatches
    && input.emailConfirmed
    && input.activeNewAccount
    && input.isDifferentInternalAccount
    && input.recoveryAvailable
    && input.ledgerVerified;
}
