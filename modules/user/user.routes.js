import express from "express";
import protect from "../../middlewares/authHandler.js";
import userManagementGuard from "../../middlewares/userManagementGuard.js";
import * as ctrl from "./user.controller.js";

const router = express.Router();

router.use(protect);

router.get("/", userManagementGuard("view"), ctrl.listUsers);
router.get("/:id", userManagementGuard("view"), ctrl.getUser);
router.post("/", userManagementGuard("add"), ctrl.createUser);
router.put("/:id", userManagementGuard("edit"), ctrl.updateUser);
router.delete("/:id", userManagementGuard("delete"), ctrl.deactivateUser);

export default router;
