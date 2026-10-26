/** Fail fast when required secrets/config are missing or weak. */
export const validateEnv = () => {
  const required = ["JWT_SECRET", "MONGO_URI"];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const secret = process.env.JWT_SECRET.trim();
  if (secret.length < 32) {
    const msg =
      "JWT_SECRET must be at least 32 characters. Use a long random value.";
    if (process.env.NODE_ENV === "production") {
      throw new Error(msg);
    }
    console.warn(`⚠️  ${msg}`);
  }
};
