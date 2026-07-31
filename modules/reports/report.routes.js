import express from "express";
import ctrl from "./report.controller.js";
import protect from "../../middlewares/authHandler.js";
import fyScope from "../../middlewares/fyScope.js";

const router = express.Router();

router.use(protect);
router.use(fyScope);

router.get("/stock", ctrl.stockReport);
router.get("/purchase", ctrl.purchaseReport);
router.get("/sales", ctrl.salesReport);
router.get("/ledger", ctrl.ledgerReport);

export default router;
