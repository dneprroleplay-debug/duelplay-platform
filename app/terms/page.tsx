import type { Metadata } from "next";
import { LegalDocument, LegalList, LegalSection } from "@/components/Legal/LegalDocument";

export const metadata: Metadata = {
  title: "Terms of Service - DuelPlay",
  description: "The rules for using DuelPlay, including accounts, duels, wallets, payouts and fair play.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      summary="These Terms explain the rules for using DuelPlay, including your account, duels, wallet, payouts and fair play obligations."
      updated="October 26, 2026"
    >
      <LegalSection title="1. Acceptance of these Terms">
        <p>
          These Terms govern your use of DuelPlay at duelplaygame.com and any related pages, matchmaking, wallet,
          support and game-server features (the Service).
        </p>
        <p>
          By signing in with Steam or using the Service, you agree to these Terms. If you do not agree, do not use
          the Service.
        </p>
        <p>
          You must also follow our Fair Play &amp; Anti-Cheat rules and our Privacy Policy. They form part of these
          Terms.
        </p>
      </LegalSection>

      <LegalSection title="2. Eligibility and your account">
        <p>
          You may use the Service only if you are at least 18 years old, or the age of majority where you live if
          that age is higher.
        </p>
        <p>
          You must be legally allowed to take part in skill-based contests for money in your jurisdiction. You are
          responsible for checking and following local law, including tax rules.
        </p>
        <p>
          DuelPlay uses Steam OpenID for sign-in. We never receive your Steam password. You must control the Steam
          account you use.
        </p>
        <p>
          You may maintain one DuelPlay account. You are responsible for activity through your account and for
          keeping your Steam account secure.
        </p>
        <p>
          We may refuse, suspend or close accounts where we reasonably believe these Terms, our fair play rules or
          applicable law have been broken.
        </p>
      </LegalSection>

      <LegalSection title="3. The Service">
        <p>
          DuelPlay provides competitive Counter-Strike 2 1v1 matchmaking, duel creation, game-server coordination,
          result handling, wallets and related community features.
        </p>
        <p>
          DEMO mode uses virtual credits. DEMO credits have no cash value, cannot be purchased for cash and cannot
          be withdrawn.
        </p>
        <p>
          REAL mode uses a USD balance. REAL-mode deposits and withdrawals are available only when a payment
          provider is enabled. If no provider is available, DuelPlay cannot accept a deposit or send a withdrawal.
        </p>
        <p>DuelPlay is not affiliated with Valve Corporation or the makers of Counter-Strike 2.</p>
      </LegalSection>

      <LegalSection title="4. Stakes, fees, results and payouts">
        <p>
          Before you confirm a duel, the interface shows the stake, commission and other applicable limits. By
          joining a duel, you authorise DuelPlay to lock the stake from your balance.
        </p>
        <p>
          The game server manager reports the result to DuelPlay through a protected result channel. The winner
          receives the pot minus the applicable commission, subject to settlement checks. The server and referee
          result is the authoritative match result.
        </p>
        <p>
          If a duel is cancelled, voided or ends without a valid result, stakes are returned to the players&apos;
          balances using the platform&apos;s settlement rules.
        </p>
        <p>
          If you disconnect, fail to join or miss the connection deadline, the match may end by forfeit or be
          cancelled under the rules shown in the match. Check the match screen and our Fair Play rules.
        </p>
        <p>
          A wallet balance is not a bank account and does not earn interest. You may not sell, transfer or exchange
          balances with other users outside the Service.
        </p>
      </LegalSection>

      <LegalSection title="5. Deposits, withdrawals and verification">
        <p>
          Deposits and withdrawals are processed only through payment providers supported by DuelPlay. Minimum and
          maximum limits, daily limits and provider availability may apply.
        </p>
        <p>
          We may require identity or source-of-funds checks before a withdrawal. Withdrawals may be placed under
          manual review where risk signals, payment issues or legal requirements call for it.
        </p>
        <p>
          We do not publish a self-service refund procedure. If you believe a deposit or withdrawal was made in
          error, contact support so the case can be reviewed under these Terms and applicable law.
        </p>
        <p>
          Initiating a chargeback or payment dispute against a completed deposit may lead to account restrictions
          while the dispute is investigated.
        </p>
        <p>You are responsible for taxes that apply to your winnings or other amounts you receive.</p>
      </LegalSection>

      <LegalSection title="6. Prohibited conduct">
        <LegalList
          items={[
            "Cheating, exploiting bugs, manipulating matches, sharing accounts, using multiple accounts to evade limits, win trading, collusion or match fixing.",
            "Using unauthorised software, scripts, macros or modifications in a DuelPlay match, or interfering with DuelPlay servers, the game server manager or other players' connections.",
            "Harassing, threatening, doxing, impersonating, scamming or spamming other users, or uploading unlawful, hateful or infringing content.",
            "Using the Service for money laundering, fraud, terrorist financing, sanctions evasion or any other illegal purpose.",
            "Bypassing age, regional, payment or security controls.",
          ]}
        />
      </LegalSection>

      <LegalSection title="7. Fair play, reports and disputes">
        <p>
          DuelPlay may review server logs, game-state signals, demos, match data, reports and other evidence to
          protect match integrity.
        </p>
        <p>
          You can report suspected cheating or abuse through the in-app report tools or support. Include the match
          ID, player, time and available evidence.
        </p>
        <p>
          We may void a match, adjust a settlement, restrict a wallet or suspend an account while a dispute is
          reviewed. Where the law allows, confirmed cheating may lead to forfeiture of affected stakes and account
          closure.
        </p>
        <p>Knowingly false or abusive reports may lead to restrictions on your account.</p>
      </LegalSection>

      <LegalSection title="8. Your content">
        <p>
          You keep ownership of content you submit, such as your nickname, avatar, messages and reports. You grant
          DuelPlay a non-exclusive licence to host, display and process that content as needed to run the Service.
        </p>
        <p>
          You must have the rights needed to submit your content. We may remove content that breaks these Terms or
          applicable law.
        </p>
      </LegalSection>

      <LegalSection title="9. Suspension and closure">
        <p>
          You may stop using the Service at any time. To request account closure, contact support. We may need to
          verify that you control the Steam account.
        </p>
        <p>
          We may suspend or close your account, restrict features or cancel open activity if we reasonably believe
          you broke these Terms, created risk for other users or must be restricted by law.
        </p>
        <p>
          Open obligations, transaction records, chargebacks, disputes and legal retention requirements may survive
          account closure.
        </p>
      </LegalSection>

      <LegalSection title="10. Availability and disclaimers">
        <p>
          The Service is provided on an as-available basis. Matchmaking, game servers, payment providers and
          third-party services can be interrupted, changed or unavailable.
        </p>
        <p>
          We do not guarantee that the Service will always be error-free, uninterrupted or free of loss. Nothing in
          these Terms excludes rights that applicable consumer law does not allow us to exclude.
        </p>
        <p>
          Valve, Steam, payment providers and your internet provider are independent third parties. Their terms and
          availability apply to their services.
        </p>
      </LegalSection>

      <LegalSection title="11. Limitation of liability">
        <p>
          To the maximum extent permitted by law, DuelPlay is not liable for indirect, incidental or consequential
          losses, lost profits or lost data arising from the Service.
        </p>
        <p>
          Where liability cannot be excluded, our liability is limited to the amount of the affected transaction or
          the minimum required by law. This does not limit mandatory consumer rights.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes to these Terms">
        <p>
          We may update these Terms as the Service or legal requirements change. We will publish the new version and
          update the date above.
        </p>
        <p>
          If a change materially affects your rights, we will take reasonable steps to make it visible before it
          applies. Continued use after the effective date means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection title="13. General">
        <p>
          If any provision of these Terms is found unenforceable, the remaining provisions stay in effect. A failure
          to enforce a provision is not a waiver of our right to enforce it later.
        </p>
        <p>
          These Terms do not limit mandatory rights available under the consumer or data protection laws that apply
          to you.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
