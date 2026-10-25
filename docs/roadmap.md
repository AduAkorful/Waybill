# Roadmap

What is not available yet, and what is being considered. Nothing here is a commitment.

## Not available today

* **An independent audit.** The contracts have been tested heavily (unit, fuzz, invariant and fork tests) but no outside firm has reviewed them. The early-access limits stay until one has.
* **A multi-signature operator wallet.** The operator wallet is one account. It is fixed in every contract at deployment, so moving to a multi-signature wallet means a new deployment.
* **Screens for the bond and financing vaults.** The BondVault (attestor bonds and penalties) and the FinancingVault (lenders and supplier loans) are deployed and verified, but the web app has no screens for them yet. They can be used directly through the contracts.
* **Email updates by default.** The code is built, but updates are sent only on deployments that have a mail provider configured.
* **A native-speaker review of the Chinese text.** The Chinese supplier page is a draft.
* **Reviewed legal terms.** The terms, privacy and security page (`/legal`) is a plain-language draft and says so.
* **A published retention policy for evidence files.**

## Being considered

* Larger limits, in steps, once an audit is done.
* A multi-signature operator wallet, in a new deployment.
