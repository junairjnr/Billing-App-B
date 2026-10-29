import userModel from "./user.model.js";
import CustomRole from "../settings/customRole.model.js";
import Branch from "../branch/branch.model.js";
import ApiError from "../../utils/ApiError.js";
import {
  ASSIGNABLE_ROLES,
  PRIVILEGED_ROLES,
  isSystemRole,
} from "../settings/permissions.constants.js";
import { requireString } from "../../utils/sanitizeInput.js";
import { deleteProfileUploadFile } from "../upload/upload.utils.js";
import path from "path";

const USER_SELECT = "-password -inviteToken -inviteTokenExpiry";

const assertAssignableRole = async (companyId, role, actorRole) => {
  if (role === "super_admin") {
    throw new ApiError(400, "Super admin role cannot be assigned");
  }

  if (PRIVILEGED_ROLES.includes(role) && actorRole !== "super_admin") {
    throw new ApiError(403, "Only super admin can assign admin roles");
  }

  if (isSystemRole(role)) {
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new ApiError(400, "Invalid role");
    }
    return;
  }

  const customRole = await CustomRole.findOne({
    companyId,
    slug: role,
    isActive: true,
  }).select("_id");

  if (!customRole) throw new ApiError(400, "Invalid custom role");
};

const assertBranchInCompany = async (companyId, branchId) => {
  const branch = await Branch.findOne({ _id: branchId, companyId, isActive: true }).select("_id");
  if (!branch) throw new ApiError(400, "Invalid branch");
};

const createUser = async ({
  companyId,
  branchId,
  createdBy,
  name,
  email,
  role,
  password,
  actorRole,
}) => {
  await assertBranchInCompany(companyId, branchId);
  await assertAssignableRole(companyId, role, actorRole);

  const safeEmail = requireString(email, "email", { maxLength: 254 }).toLowerCase();
  const exists = await userModel.findOne({ email: safeEmail });
  if (exists) throw new ApiError(409, "Email already in use");

  const user = await userModel.create({
    companyId,
    branchId,
    createdBy,
    name: requireString(name, "name", { maxLength: 120 }),
    email: safeEmail,
    password,
    role,
    isVerified: true,
  });

  user.password = undefined;
  return user;
};

const getCompanyUsers = async (companyId, branchId, actorRole) => {
  const filter = { companyId };
  const canSeeAll =
    actorRole === "super_admin" ||
    actorRole === "admin" ||
    actorRole === "secondary_admin";

  if (!canSeeAll && branchId) filter.branchId = branchId;

  return userModel
    .find(filter)
    .select(USER_SELECT)
    .populate("branchId", "name code")
    .sort({ createdAt: -1 });
};

const getUserById = async (companyId, userId) => {
  const user = await userModel
    .findOne({ _id: userId, companyId })
    .select(USER_SELECT)
    .populate("branchId", "name code");

  if (!user) throw new ApiError(404, "User not found");
  return user;
};

const updateUser = async (companyId, userId, payload, actor) => {
  const user = await userModel.findOne({ _id: userId, companyId });
  if (!user) throw new ApiError(404, "User not found");

  if (user.role === "super_admin" && actor.id !== user._id.toString()) {
    throw new ApiError(403, "Super admin account cannot be modified");
  }

  const { name, role, branchId, isActive, password } = payload;

  if (name !== undefined) {
    user.name = requireString(name, "name", { maxLength: 120 });
  }

  if (branchId !== undefined) {
    await assertBranchInCompany(companyId, branchId);
    user.branchId = branchId;
  }

  if (role !== undefined) {
    if (user.role === "super_admin") {
      throw new ApiError(400, "Super admin role cannot be changed");
    }
    await assertAssignableRole(companyId, role, actor.role);
    user.role = role;
  }

  if (isActive !== undefined) {
    if (actor.id === user._id.toString() && isActive === false) {
      throw new ApiError(400, "You cannot deactivate your own account");
    }
    if (user.role === "super_admin" && isActive === false) {
      throw new ApiError(400, "Super admin account cannot be deactivated");
    }
    user.isActive = Boolean(isActive);
  }

  if (password) {
    if (typeof password !== "string" || password.length < 6) {
      throw new ApiError(400, "Password must be at least 6 characters");
    }
    user.password = password;
  }

  await user.save();
  user.password = undefined;
  return user;
};

const getMe = async (companyId, userId) => {
  return getUserById(companyId, userId);
};

const updateMe = async (companyId, userId, payload) => {
  const user = await userModel.findOne({ _id: userId, companyId });
  if (!user) throw new ApiError(404, "User not found");

  const { name, profileImage } = payload;

  if (name !== undefined) {
    user.name = requireString(name, "name", { maxLength: 120 });
  }

  if (profileImage !== undefined) {
    const nextImage =
      profileImage === null || profileImage === ""
        ? null
        : path.basename(String(profileImage));
    if (user.profileImage && user.profileImage !== nextImage) {
      deleteProfileUploadFile(companyId, user.profileImage);
    }
    user.profileImage = nextImage;
  }

  await user.save();
  return getUserById(companyId, userId);
};

const changePassword = async (
  companyId,
  userId,
  currentPassword,
  newPassword,
) => {
  const user = await userModel
    .findOne({ _id: userId, companyId })
    .select("+password");
  if (!user) throw new ApiError(404, "User not found");

  if (
    typeof currentPassword !== "string" ||
    !currentPassword ||
    !(await user.comparePassword(currentPassword))
  ) {
    throw new ApiError(400, "Current password is incorrect");
  }

  if (typeof newPassword !== "string" || newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  user.password = newPassword;
  await user.save();
};

const uploadMyProfileImage = async (companyId, userId, fileName) => {
  const safeName = path.basename(String(fileName || ""));
  if (!safeName) throw new ApiError(400, "Invalid profile image");

  const user = await userModel.findOne({ _id: userId, companyId });
  if (!user) throw new ApiError(404, "User not found");

  if (user.profileImage && user.profileImage !== safeName) {
    deleteProfileUploadFile(companyId, user.profileImage);
  }

  user.profileImage = safeName;
  await user.save();
  return getUserById(companyId, userId);
};

const deactivateUser = async (companyId, userId, actor) => {
  const user = await userModel.findOne({ _id: userId, companyId });
  if (!user) throw new ApiError(404, "User not found");

  if (actor.id === user._id.toString()) {
    throw new ApiError(400, "You cannot deactivate your own account");
  }

  if (user.role === "super_admin") {
    throw new ApiError(400, "Super admin account cannot be deactivated");
  }

  user.isActive = false;
  await user.save();
};

export default {
  createUser,
  getCompanyUsers,
  getUserById,
  getMe,
  updateMe,
  changePassword,
  uploadMyProfileImage,
  updateUser,
  deactivateUser,
};
