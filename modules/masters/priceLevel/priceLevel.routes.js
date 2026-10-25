import PriceLevel from "./priceLevel.model.js";
// import { roleGuard } from "../../../middleware/roleGuard.js";

import express from "express";
import protect from "../../../middlewares/authHandler.js";
import crudFactory from "../../../utils/crudFactory.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import ApiError from "../../../utils/ApiError.js";
import { assertPriceLevelNotInUse } from "../masterUsage.service.js";

const router = express.Router();

const ctrl = crudFactory(PriceLevel, {
  selectFields: "name taxPercent isActive createdAt",
  hasTextIndex: true,
});

router.use(protect);

router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getOne);
router.post("/add", ctrl.create);
router.put("/:id", ctrl.update);
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertPriceLevelNotInUse(req.companyId, req.params.id);
    const doc = await PriceLevel.findOneAndDelete({
      _id: req.params.id,
      companyId: req.companyId,
    }).lean();
    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, null, "Deleted successfully"));
  })
);

// router.patch("/:id/restore", ctrl.restore);
// router.get("/", ctrl.getAll);
// router.get("/:id", ctrl.getOne);
// router.post("/", roleGuard("admin", "manager"), ctrl.create);
// router.put("/:id", roleGuard("admin", "manager"), ctrl.update);
// router.delete("/:id", roleGuard("admin"), ctrl.remove);
// router.patch("/:id/restore", roleGuard("admin"), ctrl.restore);

export default router;
