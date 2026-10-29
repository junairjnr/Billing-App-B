import { Router } from "express";
import protect from "../../middlewares/authHandler.js";
import { uploadPurchaseDocument } from "./upload.middleware.js";
import {
  uploadPurchaseFile,
  downloadPurchaseFile,
  deletePurchaseFile,
  downloadProfileFile,
} from "./upload.controller.js";

const router = Router();

router.post(
  "/purchase",
  protect,
  (req, res, next) => {
    uploadPurchaseDocument(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  uploadPurchaseFile
);

router.get("/purchase/:fileName", protect, downloadPurchaseFile);

router.delete("/purchase/:fileName", protect, deletePurchaseFile);

router.get("/profile/:fileName", protect, downloadProfileFile);

export default router;
