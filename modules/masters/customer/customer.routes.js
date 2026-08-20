import express from "express";
import protect from "../../../middlewares/authHandler.js";
import crudFactory from "../../../utils/crudFactory.js";
import customerModel from "./customer.model.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";

const router = express.Router();

// const ctrl = crudFactory(customerModel);
const ctrl = crudFactory(customerModel, {
  selectFields:
    "name email phone gstin customerType creditLimit address isActive createdAt type",
  hasTextIndex: true,
});

router.get(
  "/search",
  protect,
  asyncHandler(async (req, res) => {
    const { q = "", type, customerType } = req.query;

    const filter = { companyId: req.companyId, isActive: true };
    if (type) filter.type = type;
    if (customerType) filter.customerType = customerType;
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }

    const data = await customerModel.find(filter)
      .select("name phone type customerType gstin address")
      .limit(10)
      .lean();

    res.json(new ApiResponse(200, data));
  })
);

router.use(protect);
router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getOne);
router.post("/add", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;
