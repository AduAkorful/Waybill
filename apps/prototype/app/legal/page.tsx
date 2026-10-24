import { PublicShell } from "@/components/PublicShell";

export const metadata = { title: "Terms, privacy and security · Waybill prototype" };

const sections = [
  {
    id: "terms",
    title: "Terms",
    points: [
      "Waybill is for businesses. You confirm business use when you create a deal.",
      "Waybill is not a bank, custodian, lender or court. Escrowed money moves only by the rules fixed when the deal is funded.",
      "An arbiter's decision decides where one frozen part goes. It does not settle customs, tax or wider contract claims, and you keep your legal remedies.",
      "Attestors sign narrow, templated statements. Their liability is limited to the words they signed.",
      "Early-access caps on deal size and total value apply and are shown in the product.",
    ],
  },
  {
    id: "privacy",
    title: "Privacy",
    points: [
      "Commercial detail (goods, prices, party names) stays off the public page unless the parties choose to show it. Wallet addresses on the explorer are always public.",
      "Contact details are stored separately from deal data, kept to the minimum, and deleted after a stated retention period.",
      "Evidence files are encrypted, stored in two places, and kept for the dispute period plus one year after settlement unless a dispute or legal hold needs them longer.",
    ],
  },
  {
    id: "security",
    title: "Security contact",
    points: [
      "Found a problem? Email security@waybill.demo. We'll acknowledge within one business day.",
      "Waybill will never ask for your seed phrase or private key, in the app, by email or on WhatsApp.",
    ],
  },
];

export default function Legal() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-20 md:px-8 md:pt-14">
        <p className="label">Draft for review by counsel</p>
        <h1 className="mt-2 text-[34px] leading-tight font-semibold tracking-tight">Terms, privacy and security</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-graphite">
          Plain-language summaries of the commitments the product is built around. The full documents are written and reviewed before launch; nothing here is legal
          advice.
        </p>
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="mt-10 scroll-mt-20 border-t border-ink/80 pt-4">
            <h2 className="text-[20px] font-semibold">{s.title}</h2>
            <ul className="mt-3 space-y-2.5 text-[14.5px] leading-relaxed">
              {s.points.map((p) => (
                <li key={p} className="flex gap-3">
                  <span aria-hidden className="mt-[10px] h-px w-3 shrink-0 bg-graphite" />
                  {p}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </PublicShell>
  );
}
