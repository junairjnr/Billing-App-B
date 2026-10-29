// load .env FIRST before anything else
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { validateEnv } from "./utils/validateEnv.js";
validateEnv();

import http from "http";
import app from "./app.js";
import { syncItemIndexes } from "./modules/masters/item/item.service.js";
import { createSocketServer } from "./socket/socketServer.js";

const PORT = process.env.PORT || 8008;

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3005",
  "https://billing-app-f.vercel.app",
  "https://www.pksbrozco.com",
  process.env.CLIENT_URL,
].filter(Boolean);
const MONGO_URI = process.env.MONGO_URI;

// Connect to MongoDB first, then start server
const startServer = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");

    try {
      await syncItemIndexes();
      console.log("✅ Item indexes synced");
    } catch (error) {
      console.warn("⚠️ Item index sync skipped:", error.message);
    }

    const httpServer = http.createServer(app);
    createSocketServer(httpServer, allowedOrigins);

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log("🔌 Socket.IO enabled on /socket.io");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    process.exit(1); // stop the process if DB connection fails
  }
};

startServer();
