import mongoose from "mongoose";

const purchaseReturnItemSchema = new mongoose.Schema(
  {
    slNo: { type: Number, required: true },
    invoiceItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    hsn: { type: String, trim: true },
    uomId: { type: mongoose.Schema.Types.ObjectId, ref: "Uom", required: true },
    rate: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 0 },
    taxableValue: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  { _id: true }
);

const purchaseReturnSchema = new mongoose.Schema(
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
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    returnNo: { type: String, required: true },
    returnDate: { type: Date, required: true },

    purchaseInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseInvoice",
      required: true,
    },
    originalInvoiceNo: { type: String, required: true },
    vendorInvoiceNo: { type: String, trim: true },

    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    vendorSnapshot: {
      name: String,
      gstin: String,
      place: String,
      state: String,
      stateCode: String,
      address: String,
    },

    items: [purchaseReturnItemSchema],

    netAmount: { type: Number, default: 0 },
    totalSGST: { type: Number, default: 0 },
    totalCGST: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["confirmed", "cancelled"],
      default: "confirmed",
    },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

purchaseReturnSchema.index({ companyId: 1, branchId: 1, financialYearId: 1 });
purchaseReturnSchema.index(
  { companyId: 1, returnNo: 1, financialYearId: 1 },
  { unique: true }
);
purchaseReturnSchema.index({ companyId: 1, purchaseInvoiceId: 1 });
purchaseReturnSchema.index({ companyId: 1, vendorId: 1, financialYearId: 1 });
purchaseReturnSchema.index({ companyId: 1, returnDate: -1 });

export default mongoose.model("PurchaseReturn", purchaseReturnSchema);
