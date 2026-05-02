import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ItemCategory",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true }, // SKU / item code
    unit: { type: String, default: "pcs" }, // pcs, kg, ltr, etc.
    price: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, default: 0 }, // GST %
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

itemSchema.index({ companyId: 1, code: 1 }, { unique: true, sparse: true });

export default mongoose.model("Item", itemSchema);
