import type { Metadata } from "next";
import { LegalDocument, LegalList, LegalSection } from "@/components/Legal/LegalDocument";

export const metadata: Metadata = {
  title: "Fair Play & Anti-Cheat - DuelPlay",
  description: "The anti-cheat, match integrity and reporting rules for DuelPlay.",
};

export default function FairPlayPage() {
  return (
    <LegalDocument
      title="Fair Play & Anti-Cheat"
      summary="DuelPlay is built on skill. These rules protect fair matches, honest results and a safe community."
      updated="October 26, 2026"
    >
      <LegalSection title="1. Our standard">
        <p>
          Every player must have a fair chance to win, and every result must reflect what happened on the server.
        </p>
        <p>
          This policy applies to all matches, including REAL and DEMO, and to behaviour in the app, Discord and
          other DuelPlay spaces.
        </p>
      </LegalSection>

      <LegalSection title="2. Prohibited cheating">
        <LegalList
          items={[
            "Cheats, hacks, aim assist, wallhacks, triggerbots, ESP, radar hacks, spinbots or any unauthorised third-party software.",
            "Scripts, macros, auto-exec, bhop helpers or configuration that gives an unfair input advantage.",
            "Injecting DLLs, modifying game files, abusing the game client or bypassing server integrity checks.",
            "Exploiting map bugs, smoke or flash bugs, out-of-map positions, economy bugs or any unintended game behaviour to gain an advantage.",
            "Boosting, deranking on purpose, win trading, collusion, match fixing or betting against yourself.",
            "Smurfing, multi-accounting, account sharing, buying or selling accounts, or evading a suspension.",
            "VPN, proxy or region manipulation to bypass restrictions, limits or matchmaking rules.",
            "DDoS, server flooding, packet manipulation, exploiting the manager API or disrupting another player's connection.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Account integrity">
        <p>You are responsible for every match played through your Steam account.</p>
        <p>
          Do not let another person play on your account in a DuelPlay match. Do not share session cookies or Steam
          credentials.
        </p>
        <p>
          If you suspect your account is compromised, change your Steam password, revoke sessions and contact
          support.
        </p>
      </LegalSection>

      <LegalSection title="4. Match integrity and results">
        <p>
          DuelPlay&apos;s game server manager starts the match, tracks connection state and reports the result
          through a protected result channel.
        </p>
        <p>
          The server and referee result is authoritative. Players cannot self-report a winner in REAL or DEMO
          settlement.
        </p>
        <p>
          Connection and start deadlines apply. If nobody connects, the match may be cancelled and stakes returned.
          If only one player connects, the match may be decided by forfeit.
        </p>
        <p>Do not delay, disconnect on purpose or refuse to play to manipulate a settlement.</p>
      </LegalSection>

      <LegalSection title="5. Detection and review">
        <p>
          We review signals including server logs, game-state integration, connection data, result reports, match
          statistics, player reports, demo files and account history.
        </p>
        <p>
          We may ask for clips, demos or other evidence. Refusing to cooperate may be considered in a review.
        </p>
        <p>
          No detection system is perfect. We combine automated signals with manual review and aim to make decisions
          based on evidence.
        </p>
        <p>
          We may preserve match data and evidence while a case is open, as described in the Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="6. Penalties">
        <LegalList
          items={[
            "Warnings and required account changes.",
            "Voiding a match, reversing a settlement or returning affected stakes where appropriate.",
            "Temporary suspension, feature restrictions or wallet review.",
            "Permanent ban for serious or repeated violations.",
            "Forfeiture of affected stakes where the law allows, and referral of suspected fraud or illegal activity to the relevant authorities.",
          ]}
        />
        <p>We aim to apply penalties consistently and proportionally, but each case depends on its facts.</p>
      </LegalSection>

      <LegalSection title="7. Reporting">
        <p>Use the in-app report tools for cheating, abuse, match fixing or other rule violations.</p>
        <p>
          Include the match ID, player nickname or SteamID, time, map and any clips or demo evidence.
        </p>
        <p>Do not publicly accuse or harass players. Send evidence to support or moderators.</p>
        <p>Knowingly false or retaliatory reports may lead to restrictions.</p>
      </LegalSection>

      <LegalSection title="8. Appeals">
        <p>
          If you believe a penalty is wrong, contact support with the match or case ID and a clear explanation.
        </p>
        <p>
          We will review the available evidence and may ask for more information. We cannot guarantee a response
          time.
        </p>
        <p>Do not create new accounts or ask others to appeal for you while a ban is active.</p>
      </LegalSection>

      <LegalSection title="9. Cooperation with third parties">
        <p>
          We may share relevant evidence with Valve, server providers, payment providers or law enforcement where
          needed to investigate fraud, cheating or illegal activity, subject to the Privacy Policy.
        </p>
        <p>
          We are not affiliated with Valve. Valve&apos;s own rules and enforcement apply separately.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to this policy">
        <p>
          We may update this policy as new cheats, game changes or platform features appear. We will publish the new
          version and update the date above.
        </p>
        <p>Continued use of the Service means you accept the updated policy.</p>
      </LegalSection>
    </LegalDocument>
  );
}
