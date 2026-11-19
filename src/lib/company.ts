/**
 * Who operates Riffscribe, for the legal pages and the footer. Danish law
 * (E-commerce Act §7, Consumer Contracts Act) wants the operator's identity on
 * a site that sells to consumers. These are left blank until the owner fills
 * them in; the pages fall back to a short "operated by 6x7" line while any
 * required field is null.
 */
export const COMPANY: {
  legalName: string | null;
  cvr: string | null;
  address: string | null;
  vatId: string | null;
  phone: string | null;
  contactEmail: string;
  authority: string;
} = {
  legalName: null,
  cvr: null,
  address: null,
  vatId: null,
  phone: null,
  contactEmail: "admin@6x7.gr",
  authority: "Datatilsynet (datatilsynet.dk)",
};

/** True once the legal name, CVR number and postal address are all filled in. */
export const companyComplete = (): boolean => Boolean(COMPANY.legalName && COMPANY.cvr && COMPANY.address);

/** The identity as one line, or null while it is incomplete. */
export function companyLine(): string | null {
  if (!companyComplete()) return null;
  return [COMPANY.legalName, `CVR ${COMPANY.cvr}`, COMPANY.vatId && `VAT ${COMPANY.vatId}`, COMPANY.address]
    .filter(Boolean)
    .join(" · ");
}
