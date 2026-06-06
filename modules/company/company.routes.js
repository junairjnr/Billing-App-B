import express from "express";
import companyService from "./company.service.js";
import protect from "../../middlewares/authHandler.js";

const router = express.Router();

router.use(protect);

router.get("/:id", companyService.getCompanyDetails);
router.get("/all", companyService.getAllCompanies);
router.put("/:id", companyService.updateCompanyDetails);

export default router;
