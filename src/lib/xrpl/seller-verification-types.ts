/**
 * Client-safe types + constants for Borneo "verified seller" on XRPL.
 *
 * Borneo acts as a credential issuer (XLS-70 Credentials). A merchant's payout
 * address holds an accepted `BorneoVerifiedSeller` credential, and a DID
 * (XLS-40) on that same address points at the merchant's Borneo seller doc.
 * Buyer agents can check both straight from any XRPL node — no trust in the
 * Borneo server required.
 */

/** ASCII credential type. On-ledger value is the uppercase hex of this. */
export const SELLER_CREDENTIAL_TYPE = "BorneoVerifiedSeller";

/** XLS-40 DID `Data` marker written by the merchant. */
export const SELLER_DID_DATA = "borneo:verified-seller";

/** lsfAccepted flag on a Credential ledger entry. */
export const LSF_CREDENTIAL_ACCEPTED = 0x00010000;

export type SellerVerificationStatus =
  /** Credential exists, accepted by the merchant, not expired. */
  | "verified"
  /** Borneo issued it; merchant has not signed CredentialAccept yet. */
  | "pending_accept"
  /** Credential exists but Expiration has passed. */
  | "expired"
  /** No credential (or issuer not configured / ledger unreachable). */
  | "unverified";

export type SellerDid = {
  /** did:xrpl:{networkId}:{address} */
  id: string;
  uri: string | null;
  data: string | null;
};

export type SellerVerification = {
  address: string;
  status: SellerVerificationStatus;
  /** True only when status === "verified". */
  onLedger: boolean;
  issuer: string | null;
  credentialType: string;
  credentialTypeHex: string;
  /** Ledger object ID of the Credential entry, when found. */
  credentialIndex?: string;
  expiresAt?: string | null;
  did: SellerDid | null;
  /** DID URI on the merchant account points to this address's Borneo seller doc. */
  didLinked: boolean;
  network: string;
  checkedAt: string;
  /** Why the status is not "verified" (machine-readable). */
  reason?: string;
};

/** Compact badge for registry / search / agent cards. */
export type SellerBadge = Pick<
  SellerVerification,
  "status" | "onLedger" | "issuer" | "credentialType" | "didLinked" | "checkedAt"
> & { did: string | null };

export function toSellerBadge(v: SellerVerification): SellerBadge {
  return {
    status: v.status,
    onLedger: v.onLedger,
    issuer: v.issuer,
    credentialType: v.credentialType,
    didLinked: v.didLinked,
    did: v.did?.id ?? null,
    checkedAt: v.checkedAt,
  };
}

/** Path of the merchant-level seller doc the DID URI resolves to. */
export function sellerDidDocPath(address: string) {
  return `/sellers/${address}/did.json`;
}
