import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: String,
    address: String,
    logo: String,
    isActive: { type: Boolean, default: true },
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Company", companySchema);
