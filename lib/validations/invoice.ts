import { z } from "zod";
import {
  getValidationMessages,
  type ValidationMessages,
} from "./locales";
import type { Locale } from "@/i18n/config";
import { MAX_INVOICE_PDF_BYTES } from "./upload";

// ─── Schema factories ─────────────────────────────────────────────────────────
//
// All human-readable error strings are supplied via a `ValidationMessages`
// object so that schemas are rebuilt whenever the locale changes.  The default
// exported schema objects use English messages for backward-compat (e.g. server
// actions, tests that don't need i18n).

/** Step 1 — invoice details */
export function buildInvoiceDetailsStepSchema(msgs: ValidationMessages) {
  return z.object({
    invoiceNumber: z
      .string()
      .min(1, msgs.invoiceNumberRequired)
      .regex(
        /^[a-zA-Z0-9-]+$/,
        msgs.invoiceNumberInvalid
      ),
    debtorName: z
      .string()
      .min(2, msgs.debtorNameRequired),
    debtorAddress: z
      .string()
      .min(5, msgs.debtorAddressRequired),
    amount: z.coerce
      .number()
      .positive(msgs.amountPositive)
      .min(100, msgs.amountMin),
    dueDate: z.string().min(1, msgs.dueDateRequired),
    description: z
      .string()
      .max(200, msgs.descriptionMaxLength)
      .optional(),
    jurisdiction: z.enum(["US", "EU", "UK", "NG", "KE", "GH", "ZA", "OTHER"]),
    category: z.enum([
      "technology",
      "manufacturing",
      "logistics",
      "healthcare",
      "retail",
      "construction",
      "agriculture",
      "energy",
      "finance",
      "other",
    ]),
    debtorPrivacy: z.enum(["full", "partial", "anonymized"]),
  });
}

/** Step 2 — financing terms */
export function buildFinancingTermsSchema(msgs: ValidationMessages) {
  return z
    .object({
      amount: z.coerce.number().positive(msgs.amountPositive),
      dueDate: z.string().min(1, msgs.dueDateRequired),
      discountRate: z.coerce
        .number()
        .min(0.5, msgs.discountRateMin)
        .max(20, msgs.discountRateMax),
      minInvestment: z.coerce
        .number()
        .positive(msgs.minInvestmentPositive)
        .min(100, msgs.minInvestmentMin),
      listingExpiryDate: z
        .string()
        .min(1, msgs.listingExpiryDateRequired),
    })
    .refine((d) => d.minInvestment <= d.amount, {
      message: msgs.minInvestmentExceedsAmount,
      path: ["minInvestment"],
    })
    .refine(
      (d) => {
        if (!d.listingExpiryDate || !d.dueDate) return true;
        return new Date(d.listingExpiryDate) < new Date(d.dueDate);
      },
      {
        message: msgs.listingExpiryDateBeforeDueDate,
        path: ["listingExpiryDate"],
      }
    );
}

/** Step 3 — file upload */
export function buildUploadSchema(msgs: ValidationMessages) {
  return z.object({
    file: z
      .custom<File | null | undefined>()
      .refine(
        (file) => file !== null && file !== undefined,
        msgs.fileRequired
      )
      .refine(
        (file) => {
          if (!file) return false;
          if (typeof file.type === "string") return file.type === "application/pdf";
          if (typeof file.name === "string") return file.name.toLowerCase().endsWith(".pdf");
          return false;
        },
        msgs.fileType
      )
      .refine(
        (file) => {
          if (!file) return false;
          if (typeof file.size === "number") return file.size <= MAX_INVOICE_PDF_BYTES;
          return true;
        },
        msgs.fileSize
      ),
  });
}

/** Funding amount validation */
export function buildFundingAmountSchema(msgs: ValidationMessages) {
  return z
    .object({
      amount: z.coerce.number().positive(msgs.amountPositive),
      minInvestment: z.coerce.number().positive(),
      remainingCapacity: z.coerce.number().nonnegative(),
    })
    .refine((d) => d.amount >= d.minInvestment, {
      message: msgs.fundingAmountMinInvestment,
      path: ["amount"],
    })
    .refine((d) => d.amount <= d.remainingCapacity, {
      message: msgs.fundingAmountExceedsCapacity,
      path: ["amount"],
    });
}

/** Repayment validation */
export function buildRepaymentSchema(msgs: ValidationMessages) {
  return z
    .object({
      amount: z.coerce.number().positive(msgs.amountPositive),
      outstandingBalance: z.coerce.number().nonnegative(),
    })
    .refine((d) => Math.abs(d.amount - d.outstandingBalance) < 0.01, {
      message: msgs.repaymentExactMatch,
      path: ["amount"],
    });
}

/** User profile validation */
export function buildUserProfileSchema(msgs: ValidationMessages) {
  return z.object({
    name: z.string().min(2, msgs.nameMinLength),
    email: z.string().email(msgs.emailInvalid),
    companyName: z
      .string()
      .min(2, msgs.companyNameMinLength)
      .optional()
      .or(z.literal("")),
    walletAddress: z
      .string()
      .regex(/^G[A-Z0-9]{55}$/, msgs.walletAddressInvalid),
  });
}

/** Combined create-invoice schema used by react-hook-form */
export function buildCreateInvoiceSchema(msgs: ValidationMessages) {
  return z
    .object({
      invoiceNumber: z
        .string()
        .min(1, msgs.invoiceNumberRequired)
        .regex(/^[a-zA-Z0-9-]+$/, msgs.invoiceNumberInvalid),
      debtorName: z
        .string()
        .min(2, msgs.debtorNameRequired),
      debtorAddress: z
        .string()
        .min(5, msgs.debtorAddressRequired),
      amount: z.coerce
        .number()
        .positive(msgs.amountPositive)
        .min(100, msgs.amountMin),
      currency: z.enum(["USDC", "EURC", "XLM"]),
      issueDate: z.string().min(1, "Issue date is required"),
      dueDate: z.string().min(1, msgs.dueDateRequired),
      description: z
        .string()
        .max(200, msgs.descriptionMaxLength)
        .optional(),
      jurisdiction: z.enum(["US", "EU", "UK", "NG", "KE", "GH", "ZA", "OTHER"]),
      category: z.enum([
        "technology",
        "manufacturing",
        "logistics",
        "healthcare",
        "retail",
        "construction",
        "agriculture",
        "energy",
        "finance",
        "other",
      ]),
      debtorPrivacy: z.enum(["full", "partial", "anonymized"]),
      discountRate: z.coerce
        .number()
        .min(0.5, msgs.discountRateMin)
        .max(20, msgs.discountRateMax)
        .transform((v) => v / 100),
      minInvestment: z.coerce
        .number()
        .positive(msgs.minInvestmentPositive)
        .min(100, msgs.minInvestmentMin),
      listingExpiryDate: z
        .string()
        .min(1, msgs.listingExpiryDateRequired),
    })
    .refine(
      (d) => {
        if (!d.dueDate || !d.issueDate) return true;
        return new Date(d.dueDate) > new Date(d.issueDate);
      },
      { message: msgs.dueDateAfterIssueDate, path: ["dueDate"] }
    )
    .refine(
      (d) => {
        if (d.minInvestment === undefined || d.amount === undefined) return true;
        return d.minInvestment <= d.amount;
      },
      { message: msgs.minInvestmentExceedsAmount, path: ["minInvestment"] }
    )
    .refine(
      (d) => {
        if (!d.listingExpiryDate || !d.dueDate) return true;
        return new Date(d.listingExpiryDate) < new Date(d.dueDate);
      },
      {
        message: msgs.listingExpiryDateBeforeDueDate,
        path: ["listingExpiryDate"],
      }
    );
}

// ─── Locale-aware builder ─────────────────────────────────────────────────────

/**
 * Build all invoice schemas for the given locale in one call.
 * The wizard page calls this whenever the locale changes.
 */
export function buildLocalizedInvoiceSchemas(locale: Locale) {
  const msgs = getValidationMessages(locale);
  return {
    invoiceDetailsStepSchema: buildInvoiceDetailsStepSchema(msgs),
    financingTermsSchema: buildFinancingTermsSchema(msgs),
    uploadSchema: buildUploadSchema(msgs),
    createInvoiceSchema: buildCreateInvoiceSchema(msgs),
  };
}

// ─── English defaults (backward-compat) ───────────────────────────────────────
//
// These are pre-built with English messages so that existing imports continue
// to work without any changes (server code, tests that don't test i18n, etc.).

const _enMsgs = getValidationMessages("en");

export const invoiceDetailsStepSchema = buildInvoiceDetailsStepSchema(_enMsgs);
export const invoiceDetailsSchema = invoiceDetailsStepSchema; // alias
export const financingTermsSchema = buildFinancingTermsSchema(_enMsgs);
export const uploadSchema = buildUploadSchema(_enMsgs);
export const fundingAmountSchema = buildFundingAmountSchema(_enMsgs);
export const repaymentSchema = buildRepaymentSchema(_enMsgs);
export const userProfileSchema = buildUserProfileSchema(_enMsgs);
export const createInvoiceSchema = buildCreateInvoiceSchema(_enMsgs);

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceDetailsStepSchema = z.infer<typeof invoiceDetailsStepSchema>;
export type InvoiceDetailsFormData = InvoiceDetailsStepSchema;
export type FinancingTermsFormData = z.infer<typeof financingTermsSchema>;
export type UploadFormData = z.infer<typeof uploadSchema>;
export type FundingAmountFormData = z.infer<typeof fundingAmountSchema>;
export type RepaymentFormData = z.infer<typeof repaymentSchema>;
export type UserProfileFormData = z.infer<typeof userProfileSchema>;
export type CreateInvoiceSchema = z.infer<typeof createInvoiceSchema>;

// ─── Step field lists ─────────────────────────────────────────────────────────

export const INVOICE_DETAILS_STEP_FIELDS = [
  "invoiceNumber",
  "debtorName",
  "debtorAddress",
  "amount",
  "dueDate",
  "description",
  "jurisdiction",
  "category",
  "debtorPrivacy",
] as const satisfies readonly (keyof InvoiceDetailsStepSchema)[];

export const FINANCING_TERMS_STEP_FIELDS = [
  "discountRate",
  "minInvestment",
  "listingExpiryDate",
] as const satisfies readonly (keyof FinancingTermsFormData)[];
