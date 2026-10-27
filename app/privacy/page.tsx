import type { Metadata } from "next";
import { LegalDocument, LegalList, LegalSection } from "@/components/Legal/LegalDocument";
import { getSiteSocialLinks } from "@/lib/site-social-links";

export const metadata: Metadata = {
  title: "Privacy Policy - DuelPlay",
  description: "How DuelPlay collects, uses, shares and protects personal data.",
};

export default async function PrivacyPage() {
  const socialLinks = await getSiteSocialLinks();
  return (
    <LegalDocument
      title="Privacy Policy"
      summary="This policy explains what personal data DuelPlay collects, why we use it, who we share it with and the choices you have."
      updated="October 26, 2026"
    >
      <LegalSection title="1. Scope and responsibility">
        <p>
          This Privacy Policy explains how DuelPlay handles personal data when you use duelplaygame.com, sign in
          with Steam, play duels, use the wallet or contact support.
        </p>
        <p>DuelPlay is responsible for the personal data described in this policy.</p>
        <p>
          This policy does not cover Steam, Discord, Telegram or payment providers. Those services have their own
          privacy policies.
        </p>
      </LegalSection>

      <LegalSection title="2. Data we collect">
        <LegalList
          items={[
            "Steam account data: SteamID64, Steam persona name and avatar, and the fact that Steam authenticated you. We do not receive your Steam password.",
            "Profile data: DuelPlay nickname, uploaded avatar, language, theme, profile visibility, stats visibility, challenge and message preferences, referral code and referrer.",
            "Security data: hashed session tokens, IP address, user agent, last login time, device information, two-factor status, and audit or security logs.",
            "Activity data: match history, maps and modes, results, statistics, friends, clans, messages, reports, disputes and support tickets.",
            "Wallet and payment data: balance, holds, transactions, deposits, withdrawals, payment provider references, and KYC status or provider case IDs where verification is required.",
            "Technical data: browser storage for language, theme, performance settings, season intensity and translation cache, plus server logs needed to operate and secure the Service.",
            "Country or language data you provide or that is associated with your account.",
          ]}
        />
        <p>
          We do not intentionally store full payment card numbers. When a payment provider is enabled, card and
          payment details are handled by that provider.
        </p>
      </LegalSection>

      <LegalSection title="3. Why we use data">
        <LegalList
          items={[
            "To create and secure your account, sign you in through Steam, and provide the Service.",
            "To run duels, calculate results, settle wallets, process deposits and withdrawals, and prevent fraud or abuse.",
            "To provide support, handle reports and disputes, and enforce our Terms and fair play rules.",
            "To meet legal, tax, accounting, KYC, sanctions and law-enforcement obligations.",
            "To improve reliability, debug errors and protect the Service, using aggregated or technical information where possible.",
          ]}
        />
        <p>
          Where required, we rely on your consent. You can withdraw consent at any time, but that does not affect
          processing that already took place.
        </p>
        <p>
          Other processing is based on performing our contract with you, our legitimate interests in operating a
          safe service, or legal obligations.
        </p>
      </LegalSection>

      <LegalSection title="4. Cookies and browser storage">
        <p>
          We use an essential session cookie called duelplay_session to keep you signed in. It is HTTP-only and
          expires after 30 days.
        </p>
        <p>
          We use browser storage for language, theme, performance mode, season intensity and translation cache.
          These settings stay on your device until you clear them.
        </p>
        <p>
          The translation cache may store interface text you have seen so pages load faster in your language.
        </p>
        <p>
          Blocking the session cookie prevents sign-in. Clearing browser storage may reset your preferences.
        </p>
        <p>
          We do not intentionally set third-party advertising cookies. External sites you open, such as Steam or
          Discord, may set their own cookies.
        </p>
      </LegalSection>

      <LegalSection title="5. How we share data">
        <LegalList
          items={[
            "Steam, to authenticate you and optionally load your persona name and avatar.",
            "Hosting, database, backup and email providers that process data on our instructions.",
            "Payment and identity-verification providers when those features are enabled, to process deposits, withdrawals and required checks.",
            "Moderators and administrators who need access to investigate reports, disputes, fraud or security incidents.",
            "Authorities, courts or regulators when required by law, or to protect rights, safety and match integrity.",
          ]}
        />
        <p>
          We do not sell personal data. Support email is routed through Cloudflare Email Routing to a monitored
          mailbox.
        </p>
        <p>
          When you click a Discord, Steam or Telegram link, you leave DuelPlay and those platforms&apos; policies
          apply.
        </p>
      </LegalSection>

      <LegalSection title="6. International transfers">
        <p>
          Our providers may process data in other countries. Where required, we use appropriate safeguards for
          those transfers.
        </p>
        <p>Data protection laws in those countries may differ from the laws where you live.</p>
      </LegalSection>

      <LegalSection title="7. Retention">
        <p>
          We keep account and profile data while your account is active and for a reasonable period after closure
          to handle disputes, fraud, chargebacks and legal obligations.
        </p>
        <p>
          Transaction, wallet, tax, audit and security records may be kept longer where law or fraud prevention
          requires it.
        </p>
        <p>
          Support tickets, reports and dispute evidence are kept while needed to resolve the matter and for related
          legal or safety purposes.
        </p>
        <p>
          We do not currently apply one fixed retention period to every record. Retention depends on the record
          type, legal requirements and risk.
        </p>
        <p>When data is no longer needed, we delete it or anonymise it where practicable.</p>
      </LegalSection>

      <LegalSection title="8. Your rights">
        <p>
          Depending on where you live, you may have the right to access, correct, delete, restrict or object to
          processing, receive a portable copy, or withdraw consent.
        </p>
        <p>
          To make a request, contact{" "}
          <a href={`mailto:${socialLinks.supportEmail}`} className="text-[var(--theme-accent)] hover:underline">
            {socialLinks.supportEmail}
          </a>
          . We may need to verify that you control the Steam account before acting.
        </p>
        <p>
          You can also complain to your local data protection authority. We encourage you to contact us first.
        </p>
        <p>Some rights are limited by legal retention, fraud prevention or the rights of other users.</p>
      </LegalSection>

      <LegalSection title="9. Security">
        <p>
          We use measures such as hashed session tokens, encrypted two-factor secrets, access controls, rate limits,
          audit logs and protected result channels.
        </p>
        <p>
          No system is completely secure. You should protect your Steam account and report suspected unauthorised
          access promptly.
        </p>
        <p>
          If we become aware of a breach that requires notification, we will notify you and authorities as required
          by law.
        </p>
      </LegalSection>

      <LegalSection title="10. Children">
        <p>
          The Service is not intended for anyone under 18 or the age of majority in their jurisdiction, whichever is
          higher.
        </p>
        <p>
          If we learn that a person below that age has an account, we may close it and delete or restrict the data
          as required.
        </p>
        <p>Contact support if you believe a minor is using the Service.</p>
      </LegalSection>

      <LegalSection title="11. Changes to this policy">
        <p>
          We may update this Privacy Policy as the Service or law changes. We will publish the new version and update
          the date above.
        </p>
        <p>
          If a change materially affects how we use your data, we will take reasonable steps to notify you before it
          applies.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
