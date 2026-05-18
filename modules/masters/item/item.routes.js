import express from "express";
import protect from "../../../middlewares/authHandler.js";
import crudFactory from "../../../utils/crudFactory.js";
import itemModel from "./item.model.js";

const router = express.Router();

// const ctrl = crudFactory(itemModel);
const ctrl = crudFactory(itemModel, {
  selectFields:
    "name code uomId categoryId price taxPercent description isActive createdAt",
  hasTextIndex: true,
  populateOpts: [
    { path: "categoryId", select: "name" },
    { path: "uomId", select: "name shortCode" },
  ],
});

router.use(protect);

router.get("/", ctrl.getAll);
router.get("/:id", ctrl.getOne);
router.post("/add", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;

// populateOpts: [
//   { path: "categoryId", select: "name" },
//   { path: "customerId", select: "name phone" },
//   { path: "createdBy",  select: "name email" },
// ]

//for multiple population, we can pass an array of options to the crudFactory.
// Each object in the array specifies the path to populate and the fields to select from the related document.
// This allows us to retrieve related data in a single query, improving efficiency and reducing the number of database calls.
