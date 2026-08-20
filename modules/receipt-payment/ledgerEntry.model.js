import mongoose from "mongoose";

const ledgerEntrySchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      required: true,
    },
    receiptPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReceiptPayment",
      required: true,
    },
    voucherNo: String,
    entryDate: Date,
    accountType: {
      type: String,
      enum: ["cash", "bank", "customer", "vendor"],
      required: true,
    },
    accountId: mongoose.Schema.Types.ObjectId,
    accountName: String,
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    narration: String,
  },
  { timestamps: true }
);

ledgerEntrySchema.index({ companyId: 1, receiptPaymentId: 1 });
ledgerEntrySchema.index({ companyId: 1, accountType: 1, accountId: 1 });

export default mongoose.model("LedgerEntry", ledgerEntrySchema);
