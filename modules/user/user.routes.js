import express from "express";
import userService from "./user.service.js";

const router = express.Router();

router.get("/users", userService.getCompanyUsers);

export default router;