#!/usr/bin/env node
/**
 * Verify a Borneo seller straight from the XRPL ledger — no Borneo server involved.
 * Zero dependencies (plain JSON-RPC), so any agent runtime can do the same.
 *
 *   node scripts/verify-seller.mjs <payToAddress> <borneoIssuerAddress>
 *
 * Exit code 0 = verified, 1 = not verified.
 */
const [subject, issuer] = process.argv.slice(2);
const RPC = process.env.XRPL_RPC_URL || "https://s.altnet.rippletest.net:51234/";
const CREDENTIAL_TYPE = Buffer.from("BorneoVerifiedSeller", "utf8")
  .toString("hex")
  .toUpperCase();
const LSF_ACCEPTED = 0x00010000;
const RIPPLE_EPOCH = 946684800;

if (!subject || !issuer) {
  console.error("usage: node scripts/verify-seller.mjs <payTo r…> <issuer r…>");
  process.exit(2);
}

async function ledgerEntry(params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "ledger_entry",
      params: [{ ...params, ledger_index: "validated" }],
    }),
  });
  const { result } = await res.json();
  if (result.error === "entryNotFound") return null;
  if (result.error) throw new Error(result.error_message || result.error);
  return result.node;
}

const hex = (h) => (h ? Buffer.from(h, "hex").toString("utf8") : null);

const [cred, did] = await Promise.all([
  ledgerEntry({
    credential: { subject, issuer, credential_type: CREDENTIAL_TYPE },
  }),
  ledgerEntry({ did: subject }),
]);

const accepted = cred ? (cred.Flags & LSF_ACCEPTED) !== 0 : false;
const expiresAt = cred?.Expiration
  ? new Date((cred.Expiration + RIPPLE_EPOCH) * 1000)
  : null;
const expired = expiresAt ? expiresAt <= new Date() : false;
const verified = Boolean(cred && accepted && !expired);

console.log(
  JSON.stringify(
    {
      subject,
      issuer,
      credentialType: "BorneoVerifiedSeller",
      credentialFound: Boolean(cred),
      accepted,
      expiresAt: expiresAt?.toISOString() ?? null,
      expired,
      did: did ? { uri: hex(did.URI), data: hex(did.Data) } : null,
      verified,
    },
    null,
    2,
  ),
);
process.exit(verified ? 0 : 1);
