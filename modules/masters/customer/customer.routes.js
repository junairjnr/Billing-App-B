import express from "express";
import protect from "../../../middlewares/authHandler.js";
import crudFactory from "../../../utils/crudFactory.js";
import customerModel from "./customer.model.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import ApiResponse from "../../../utils/ApiResponse.js";
import ApiError from "../../../utils/ApiError.js";
import {
  assertUniqueCustomerName,
  salesPartyListCustomerTypeFilter,
} from "./customer.service.js";
import { assertCustomerNotInUse } from "../masterUsage.service.js";
import { optionalEnum, optionalSearchString } from "../../../utils/sanitizeInput.js";
import { regexContains } from "../../../utils/escapeRegex.js";

const router = express.Router();

const pickCustomerWritePayload = (body) => {
  const allowed = [
    "type",
    "name",
    "email",
    "phone",
    "gstin",
    "customerType",
    "creditLimit",
    "address",
    "isActive",
  ];
  const payload = {};
  for (const key of allowed) {
    if (body[key] !== undefined) payload[key] = body[key];
  }
  if (payload.type !== undefined) {
    optionalEnum(payload.type, ["sales", "purchase"], "party type");
  }
  if (payload.customerType !== undefined) {
    optionalEnum(payload.customerType, ["retail", "wholesale"], "customer type");
  }
  return payload;
};

const selectFields =
  "name email phone gstin customerType creditLimit address isActive createdAt type";

const ctrl = crudFactory(customerModel, {
  selectFields,
  hasTextIndex: true,
  searchFieldNames: ["name", "phone", "email", "gstin"],
  filterFields: ["type", "customerType"],
  filterFieldBuilders: {
    customerType: (value) =>
      value === "retail" || value === "wholesale"
        ? salesPartyListCustomerTypeFilter(value)
        : {},
  },
});

const create = asyncHandler(async (req, res) => {
  const payload = pickCustomerWritePayload(req.body);
  payload.name = await assertUniqueCustomerName(req.companyId, payload.name);

  try {
    const doc = await customerModel.create({
      ...payload,
      companyId: req.companyId,
    });
    res.status(201).json(new ApiResponse(201, doc, "Created successfully"));
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `Party name "${payload.name}" already exists`);
    }
    throw err;
  }
});

const update = asyncHandler(async (req, res) => {
  const payload = pickCustomerWritePayload(req.body);

  if (payload.name !== undefined) {
    payload.name = await assertUniqueCustomerName(
      req.companyId,
      payload.name,
      req.params.id
    );
  }

  try {
    const doc = await customerModel
      .findOneAndUpdate(
        { _id: req.params.id, companyId: req.companyId },
        { $set: payload },
        { new: true, runValidators: true }
      )
      .select(selectFields)
      .lean();

    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, doc, "Updated successfully"));
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, `Party name "${payload.name}" already exists`);
    }
    throw err;
  }
});

router.get(
  "/search",
  protect,
  asyncHandler(async (req, res) => {
    const q = optionalSearchString(req.query.q, 100);
    const type = optionalEnum(req.query.type, ["sales", "purchase"], "type");
    const customerType = optionalEnum(
      req.query.customerType,
      ["retail", "wholesale"],
      "customerType"
    );

    const filter = { companyId: req.companyId, isActive: true };
    if (type) filter.type = type;
    if (customerType) {
      Object.assign(filter, salesPartyListCustomerTypeFilter(customerType));
    }

    const clauses = [];
    if (q) {
      const pattern = regexContains(q);
      clauses.push({
        $or: [{ name: pattern }, { phone: pattern }],
      });
    }
    if (clauses.length === 1) Object.assign(filter, clauses[0]);
    else if (clauses.length > 1) filter.$and = clauses;

    const data = await customerModel
      .find(filter)
      .select("name phone type customerType gstin address")
      .limit(50)
      .lean();

    res.json(new ApiResponse(200, data));
  })
);

router.use(protect);
router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getOne);
router.post("/add", create);
router.put("/:id", update);
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await assertCustomerNotInUse(req.companyId, req.params.id);
    const doc = await customerModel
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
