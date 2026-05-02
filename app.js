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

const app = express();
app.use(express.json()); // ← this line MUST exist in app.js

// Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/masters/item-categories", itemCategoryRoutes);
app.use("/api/masters/items", itemRoutes);
app.use("/api/masters/customers", customerRoutes);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
