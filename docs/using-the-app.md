# Using the app

The app is at [usewaybill.vercel.app](https://usewaybill.vercel.app). You sign in with an email address or a wallet. Every action that moves money or changes a deal is a transaction your own wallet signs: Waybill never signs for you and never holds your keys.

Whoever you are in a deal, your home page (`/app`) lists the deals that name your wallet and what is waiting for you.

## As a buyer

**Create a deal** (`/app/new`).

1. Choose a template (one payment, deposit, production and delivery, or a custom set of up to eight parts) and set the total in USDC.
2. Enter the supplier's wallet. If the supplier has no wallet yet, send them to `/join`: they sign in by email, get a wallet, and copy its address back to you. The supplier's wallet is fixed when the deal is created.
3. For each part set its share of the total, what releases it (attestors, your own approval, or a due date), its due date, the grace period and the review window. Name up to five attestors for a part and how many of them must sign.
4. Pick an arbiter from the approved list, or choose a panel of three. Set how many hours the arbiter has to decide.
5. Choose who pays the protocol fee and set the fee within the allowed range.
6. Set when everyone must accept by. Optionally record the goods and people involved; this is stored by Waybill, not on the blockchain, and stays private to the parties unless you make it public.

The app checks everything the contract enforces before it asks your wallet to sign, including the size limits, so a deal that would be rejected is not sent.

**Share it.** The app gives you a link for the supplier, with buttons for WhatsApp and WeChat.

**Fund it** once everyone has accepted. If your USDC allowance to the escrow is too low, the app first asks for an approval, then the funding transaction. The money is locked in one step.

**During the deal** (`/app/deals/[id]`). You see each part, its state and the timeline. You can approve a part in review to release it early, refund a part that has become refundable, dispute a part in review (with a written reason and optional files), and withdraw a dispute you raised.

## As a supplier

Open the link the buyer sent you (`/d/[id]`). You can read the terms without signing in.

1. Sign in by email or wallet. The wallet must be the one the buyer named.
2. Choose where payments go (by default your own wallet) and accept.
3. Once the deal is funded you can follow each part. You are paid when a part is released.
4. You can dispute a part that is overdue during its grace period, and respond to a dispute the buyer raised.
5. To change where you are paid, propose a new payout wallet. It takes effect after 48 hours, and the buyer can reject it during that time.

The page is available in English and Chinese. The Chinese text is a draft and has not been reviewed by a native speaker.

## As an attestor

Open the deal from your home page (`/app/attest/[id]`). For every part that names you, the page shows the exact statement you would be signing, what signing does not cover, the part's amount and dates, and the next thing to do.

1. **Accept** the part. Accepting moves no money. You are also asked whether you have a conflict of interest; a declared conflict is stored with the deal's files.
2. When the work is done, **add your files and notes** and sign a message with your wallet. The files are stored encrypted.
3. **Sign the statement** (valid for two hours) and submit it. When enough attestors have signed, the part moves to review.

Fees you earn are listed under `/app/attestor/fees`, and you can withdraw them there. You can edit your public profile under `/app/attestor/profile`. Anyone can browse attestors, with their signed-statement counts, at `/attestors`.

## As an arbiter

You accept the role on each deal you are named in. A disputed part appears in your room (`/app/room/[id]`) with the reason, the response, every file and the deadlines. When decisions open you choose one of three outcomes: pay the supplier, refund the buyer, or split the part by a percentage. You write your reasoning, which is stored with the dispute files so both sides can read it. If you are one of a panel of three, you cast a vote and two matching votes decide.

Your fees are under `/app/arbiter/fees`. If you do not decide by your deadline, a default applies; see [Disputes](disputes.md).

## The public record

Each funded deal has a public page (`/record/[id]`) that shows its parts, who has agreed, the ledger and the history with links to the explorer. A printable version is at `/record/[id]/print`. Details about goods and people appear only if the buyer made them public.

## Email updates

If the deployment has a mail provider configured, you can add an email address under `/app/settings`. It is used only for updates about your deals, and only after you confirm it from a link sent to that address.
