// import express from "express";
// import cors from "cors";
// import helmet from "helmet";
// import morgan from "morgan";

// import errorHandler from "./middlewares/errorHandler.js";

// // Import routes
// import authRoutes from "./modules/auth/auth.routes.js";
// import itemCategoryRoutes from "./modules/masters/itemCategory/itemCategory.routes.js";
// import itemRoutes from "./modules/masters/item/item.routes.js";
// import customerRoutes from "./modules/masters/customer/customer.routes.js";
// import uomRoutes from "./modules/masters/uom/uom.routes.js";

// const app = express();
// app.use(express.json()); // ← this line MUST exist in app.js

// // app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

// // cors configuration for development (allow all origins)

// // const allowedOrigins = [
// //   "http://localhost:3000",
// //   "https://billing-app-f.vercel.app",
// // ];
// const allowedOrigins = [
//   "http://localhost:3000",
//   process.env.CLIENT_URL, // ← from Render env var
// ].filter(Boolean);

// app.use(
//   cors({
//     origin: (origin, callback) => {
//       if (!origin) return callback(null, true);
//       if (allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error(`CORS blocked: ${origin}`));
//       }
//     },
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//   })
// );

// // app.options("*", cors());

// // Middlewares
// app.use(helmet());
// app.use(express.json());
// app.use(morgan("dev"));

// // Routes
// app.use("/api/auth", authRoutes);
// app.use("/api/masters/item-categories", itemCategoryRoutes);
// app.use("/api/masters/items", itemRoutes);
// app.use("/api/masters/customers", customerRoutes);
// app.use("/api/masters/uom", uomRoutes);

// // Global error handler (must be last)
// app.use(errorHandler);

// export default app;
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import errorHandler from "./middlewares/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import itemCategoryRoutes from "./modules/masters/itemCategory/itemCategory.routes.js";
import itemRoutes from "./modules/masters/item/item.routes.js";
import customerRoutes from "./modules/masters/customer/customer.routes.js";
import uomRoutes from "./modules/masters/uom/uom.routes.js";
import priceLevel from "./modules/masters/priceLevel/priceLevel.routes.js";
import branchRoutes from "./modules/branch/branch.routes.js";
import fyRoutes from "./modules/financialYear/financialYear.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import companyRoutes from "./modules/company/company.routes.js";
import warehouseRoutes from "./modules/warehouse/warehouse.routes.js";
import purchaseRoutes from "./modules/purchase/purchaseInvoice/purchaseInvoice.routes.js";
import salesInvoiceRoutes from "./modules/sales/salesInvoice/salesInvoice.routes.js";
import reportRoutes from "./modules/reports/report.routes.js";

const app = express();

// ── 1. Allowed origins ────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "https://billing-app-f.vercel.app",
  process.env.CLIENT_URL,
].filter(Boolean);

// ── 2. CORS — must be first ───────────────────────────────────
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
    allowedHeaders: ["Content-Type", "Authorization", "x-fy-id"],
  })
);

// ── 3. Preflight — must be before routes ──────────────────────
// app.options("*", cors());
app.options("/{*any}", cors());

// ── 4. Other middleware ───────────────────────────────────────
app.use(helmet());
app.use(express.json()); // ← only once
app.use(morgan("dev"));

// ── 5. Routes ─────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/masters/item-categories", itemCategoryRoutes);
app.use("/api/masters/items", itemRoutes);
app.use("/api/masters/customers", customerRoutes);
app.use("/api/masters/uom", uomRoutes);
app.use("/api/masters/price-level", priceLevel);
app.use("/api/branches", branchRoutes);
app.use("/api/financial-years", fyRoutes);
app.use("/api/users", userRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/sales", salesInvoiceRoutes);
app.use("/api/reports", reportRoutes);

// ── 6. Error handler — must be last ───────────────────────────
app.use(errorHandler);

export default app;
