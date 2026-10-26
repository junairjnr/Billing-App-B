import jwt from "jsonwebtoken";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import User from "../modules/user/user.model.js";
import { normalizeObjectIdString } from "../utils/sanitizeInput.js";

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new ApiError(401, "Unauthorized - No token");

  const decoded = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
  });

  const user = await User.findById(decoded.id)
    .select("isActive role companyId branchId")
    .lean();
  if (!user?.isActive) {
    throw new ApiError(401, "Unauthorized - Account deactivated");
  }
  if (String(user.companyId) !== String(decoded.companyId)) {
    throw new ApiError(401, "Unauthorized - Invalid token");
  }

  const branchId =
    normalizeObjectIdString(user.branchId ?? decoded.branchId) ?? undefined;
  const companyId =
    normalizeObjectIdString(user.companyId ?? decoded.companyId) ??
    String(decoded.companyId);

  req.user = {
    ...decoded,
    id: user._id,
    role: user.role,
    branchId,
    companyId,
  };
  req.companyId = companyId;
  req.branchId = branchId;
  next();
});

export default protect;
