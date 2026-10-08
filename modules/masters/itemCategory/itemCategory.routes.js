

import express from "express";
import itemCategoryModel from "./itemCategory.model.js";
import protect from "../../../middlewares/authHandler.js";
import crudFactory from "../../../utils/crudFactory.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import ApiError from "../../../utils/ApiError.js";
import { assertCategoryNotInUse } from "../masterUsage.service.js";

const router = express.Router();

// const ctrl = crudFactory(itemCategoryModel);

const ctrl = crudFactory(itemCategoryModel, {
  selectFields: "name description isActive createdAt",
  searchFieldNames: ["name", "description"],
});

router.use(protect);


router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getOne);
router.post("/add", ctrl.create);
router.put("/:id", ctrl.update);
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertCategoryNotInUse(req.companyId, req.params.id);
    const doc = await itemCategoryModel
      .findOneAndDelete({
        _id: req.params.id,
        companyId: req.companyId,
      })
      .lean();
    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, null, "Deleted successfully"));
  })
);

export default router;
