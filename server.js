// load .env FIRST before anything else
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config(); // Load environment variables from .env file

import app from "./app.js"; // import the configured express app

const PORT = process.env.PORT || 8008;
const MONGO_URI = process.env.MONGO_URI;

// Connect to MongoDB first, then start server
const startServer = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1); // stop the process if DB connection fails
  }
};

startServer();
