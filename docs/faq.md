# FAQ

**Does Waybill hold my money?** No. The buyer's USDC sits in an escrow contract on Arc. Waybill has no key that can move it, and no function in the contract that sends a deal's money anywhere except as the deal's own rules say.

**Can Waybill pause my deal?** No. The operator wallet can stop new deals from being created or funded. It cannot stop claims, refunds, disputes, decisions or withdrawals on deals already funded.

**Can the contracts be changed?** No. They are not upgradeable. A new version is a new deployment, and existing deals stay on the old contract. The operator wallet can change only a few parameters (limits, fee range, arbiter list, treasury). Pausing new deals and lowering the limits take effect at once; raising the limits and every other change waits behind a public 48-hour delay.

**Who can send the payment after a part is confirmed?** Anyone. Waybill's relayer does it by default and pays the gas. If the relayer is down, the supplier, the buyer or any wallet can send it from the app or directly to the contract.

**What if the supplier's wallet cannot receive USDC?** The payment does not fail the deal. The part stays payable and is retried once the payout wallet is changed. The supplier proposes a new wallet; it takes effect after 48 hours, during which the buyer can reject it. The same protection applies to the buyer's refund wallet.

**What does an attestor's signature mean?** That the named person signed a short statement about that part, for that deal, on that chain. Waybill does not inspect goods and does not guarantee what an attestor confirms.

**Why does a supplier need a wallet?** Because payment is a USDC transfer on Arc. A supplier without one signs in by email at `/join` and gets a wallet created for them, then gives the address to the buyer.

**Who can read the files?** Evidence files are encrypted before they are stored. Only the people named in the deal, and the arbiter, can read them through the app. The deployment holds the encryption key, so it is a trust assumption; see [Security model](reference/security.md#privacy).

**What is public?** Everything on the blockchain: addresses, amounts, deadlines, and the fingerprints of evidence. Details a buyer records about goods and people stay private unless the buyer makes them public.

**Is there an audit?** Not yet. The early-access limits (1,000 USDC per deal, 10,000 USDC held in total) exist for that reason. See [Security model](reference/security.md).

**What if an arbiter does nothing?** After their deadline, anyone can apply the default: a dispute the buyer raised is refunded to the buyer, and one the supplier raised is paid to the supplier. See [Disputes](disputes.md).

**Does an arbiter's decision legally settle the dispute?** No. It decides where one part's money goes. The buyer and supplier keep their legal remedies.

**Can I use Waybill for personal purchases?** The app is for business deals and asks you to confirm business use when you create one.

**Is there an API?** There is a read API and the evidence and terms routes the app uses. See [API](reference/api.md). Transactions are always signed by the user's own wallet; the API cannot send one for you.
