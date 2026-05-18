import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import errorHandler from "./middlewares/errorHandler.js";

// Import routes
import authRoutes from "./modules/auth/auth.routes.js";
import itemCategoryRoutes from "./modules/masters/itemCategory/itemCategory.routes.js";
import itemRoutes from "./modules/masters/item/item.routes.js";
import customerRoutes from "./modules/masters/customer/customer.routes.js";
import uomRoutes from "./modules/masters/uom/uom.routes.js";

const app = express();
app.use(express.json()); // ← this line MUST exist in app.js

// app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

// cors configuration for development (allow all origins)

// const allowedOrigins = [
//   "http://localhost:3000",
//   "https://billing-app-f.vercel.app",
// ];
const allowedOrigins = [
  "http://localhost:3000",
  process.env.CLIENT_URL, // ← from Render env var
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// app.options("*", cors());

// Middlewares
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/masters/item-categories", itemCategoryRoutes);
app.use("/api/masters/items", itemRoutes);
app.use("/api/masters/customers", customerRoutes);
app.use("/api/masters/uom", uomRoutes);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
