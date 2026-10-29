import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import userService from "./user.service.js";
import {
  assertFileMagicMatchesMime,
  deleteProfileUploadFile,
} from "../upload/upload.utils.js";

export const getMe = asyncHandler(async (req, res) => {
  const data = await userService.getMe(req.companyId, req.user.id);
  res.json(new ApiResponse(200, data));
});

export const updateMe = asyncHandler(async (req, res) => {
  const data = await userService.updateMe(req.companyId, req.user.id, req.body);
  res.json(new ApiResponse(200, data, "Profile updated"));
});

export const changePasswordMe = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await userService.changePassword(
    req.companyId,
    req.user.id,
    currentPassword,
    newPassword,
  );
  res.json(new ApiResponse(200, null, "Password changed"));
});

export const uploadProfileImageMe = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No image uploaded");

  try {
    assertFileMagicMatchesMime(req.file.path, req.file.mimetype);
  } catch (err) {
    deleteProfileUploadFile(req.companyId, req.file.filename);
    throw err;
  }

  const data = await userService.uploadMyProfileImage(
    req.companyId,
    req.user.id,
    req.file.filename,
  );
  res.json(new ApiResponse(200, data, "Profile image updated"));
});

export const listUsers = asyncHandler(async (req, res) => {
  const data = await userService.getCompanyUsers(
    req.companyId,
    req.branchId,
    req.user.role
  );
  res.json(new ApiResponse(200, data));
});

export const getUser = asyncHandler(async (req, res) => {
  const data = await userService.getUserById(req.companyId, req.params.id);
  res.json(new ApiResponse(200, data));
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, branchId } = req.body;

  if (!password || typeof password !== "string" || password.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters");
  }

  const data = await userService.createUser({
    companyId: req.companyId,
    branchId: branchId || req.branchId,
    createdBy: req.user.id,
    name,
    email,
    role: role || "viewer",
    password,
    actorRole: req.user.role,
  });

  res.status(201).json(new ApiResponse(201, data, "User created"));
});

export const updateUser = asyncHandler(async (req, res) => {
  const data = await userService.updateUser(
    req.companyId,
    req.params.id,
    req.body,
    req.user
  );
  res.json(new ApiResponse(200, data, "User updated"));
});

export const deactivateUser = asyncHandler(async (req, res) => {
  await userService.deactivateUser(req.companyId, req.params.id, req.user);
  res.json(new ApiResponse(200, null, "User deactivated"));
});
