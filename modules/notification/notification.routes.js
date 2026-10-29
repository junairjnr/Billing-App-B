import express from "express";
import protect from "../../middlewares/authHandler.js";
import fyScope from "../../middlewares/fyScope.js";
import * as ctrl from "./notification.controller.js";

const router = express.Router();

router.use(protect);
router.use(fyScope);

router.get("/", ctrl.listNotifications);
router.patch("/read-all", ctrl.markAllRead);
router.patch("/:id/read", ctrl.setNotificationRead);

export default router;
