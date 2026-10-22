/**
 * JSON-LD structured data helpers for Lighthouse SEO ≥ 95.
 *
 * Generates schema.org structured data for each major page type.
 * Inject via <script type="application/ld+json"> in page <head> (prefer
 * server components so crawlers see structured data without JS).
 *
 * Closes #125 / #375
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://kora.finance";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Kora Protocol";

// ─── WebSite (landing page) ───────────────────────────────────────────────────

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: APP_NAME,
    url: APP_URL,
    description:
      "On-chain invoice financing protocol built on Stellar Soroban. SMEs tokenize invoices as NFTs and access instant USDC liquidity.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${APP_URL}/marketplace?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

// ─── Organization ─────────────────────────────────────────────────────────────

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: APP_NAME,
    url: APP_URL,
    logo: `${APP_URL}/icons/icon-512.png`,
    sameAs: ["https://twitter.com/KoraProtocol"],
    description:
      "Kora Protocol enables SMEs in emerging markets to tokenize unpaid invoices as NFTs on Stellar Soroban and sell them at a discount to global investors.",
  };
}

// ─── FinancialProduct (marketplace listing) ───────────────────────────────────

export interface InvoiceSchemaInput {
  id: string;
  invoiceNumber: string;
  debtorName: string;
  amount: number;
  currency: string;
  apr: number;
  dueDate: string;
  jurisdiction: string;
  category: string;
  riskTier: string;
}

export function invoiceFinancialProductSchema(invoice: InvoiceSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: `Invoice ${invoice.invoiceNumber} — ${invoice.debtorName}`,
    url: `${APP_URL}/marketplace/${invoice.id}`,
    description: `Tokenized invoice from ${invoice.debtorName}. ${invoice.apr.toFixed(2)}% APR, due ${invoice.dueDate}.`,
    provider: {
      "@type": "Organization",
      name: APP_NAME,
      url: APP_URL,
    },
    amount: {
      "@type": "MonetaryAmount",
      value: invoice.amount,
      currency: invoice.currency === "USDC" ? "USD" : invoice.currency,
    },
    annualPercentageRate: invoice.apr,
    feesAndCommissionsSpecification: `${invoice.apr.toFixed(2)}% APR discount rate`,
    category: invoice.category,
    areaServed: invoice.jurisdiction,
  };
}

// ─── BreadcrumbList ───────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${APP_URL}${item.url}`,
    })),
  };
}

// ─── FAQPage (landing) ────────────────────────────────────────────────────────

export function faqSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Kora Protocol?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Kora Protocol is an on-chain invoice financing platform built on Stellar Soroban. SMEs tokenize unpaid invoices as NFTs and sell them at a discount to global investors, receiving instant USDC liquidity.",
        },
      },
      {
        "@type": "Question",
        name: "How do investors earn yield on Kora?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Investors fund tokenized invoices at a discount. When the SME repays the invoice on the due date, investors receive their principal plus the discount amount as yield — typically 8–32% APR.",
        },
      },
      {
        "@type": "Question",
        name: "Is Kora Protocol non-custodial?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. All funds are held in Soroban smart contract escrow. Kora Protocol never holds user funds. You connect your own Stellar wallet (Freighter, xBull, LOBSTR) and sign all transactions yourself.",
        },
      },
      {
        "@type": "Question",
        name: "Which wallets are supported?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Kora Protocol supports Freighter, xBull, LOBSTR, Albedo, and Rabet — all major Stellar browser wallets.",
        },
      },
    ],
  };
}

// ─── Serializer helper ────────────────────────────────────────────────────────

/**
 * Serialize a schema object to a safe JSON string for injection into <script>.
 *
 * `<`, `>` and `&` are emitted as JSON unicode escapes so a value such as
 * `</script><script>…` cannot terminate the JSON-LD block, and U+2028/U+2029
 * are escaped because they are line terminators in older JS parsers. The
 * output is still valid JSON and round-trips through `JSON.parse`.
 */
export function serializeSchema(schema: object): string {
  return JSON.stringify(schema)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
