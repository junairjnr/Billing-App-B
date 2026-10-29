import mongoose from "mongoose";

const readBySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    readAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const notificationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    financialYearId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialYear",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["low_stock"],
      required: true,
    },
    referenceKey: {
      type: String,
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    meta: {
      stockId: mongoose.Schema.Types.ObjectId,
      itemId: mongoose.Schema.Types.ObjectId,
      itemName: String,
      itemCode: String,
      qty: Number,
      threshold: Number,
    },
    readBy: { type: [readBySchema], default: [] },
  },
  { timestamps: true },
);

notificationSchema.index(
  { companyId: 1, financialYearId: 1, referenceKey: 1 },
  { unique: true },
);

export default mongoose.model("Notification", notificationSchema);
