import express from "express";
import crudFactory from "../../../utils/crudFactory.js";
import protect from "../../../middlewares/authHandler.js";
import bankAccount from "./bank.model.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import ApiError from "../../../utils/ApiError.js";
import { assertBankAccountNotInUse } from "../masterUsage.service.js";

const router = express.Router();

const ctrl = crudFactory(bankAccount, {
  selectFields:
    "accountName bankName accountNumber ifscCode branch accountType upiId isDefault isActive createdAt",
  searchFieldNames: ["accountName", "bankName", "accountNumber", "ifscCode", "upiId"],
});

router.use(protect);
router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getOne);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertBankAccountNotInUse(req.companyId, req.params.id);
    const doc = await bankAccount
      .findOneAndDelete({
        _id: req.params.id,
        companyId: req.companyId,
      })
      .lean();
    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, null, "Deleted successfully"));
  })
);
router.patch("/:id/restore", ctrl.restore);

export default router;
