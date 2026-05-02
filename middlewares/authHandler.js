import jwt from "jsonwebtoken";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";

const protect = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new ApiError(401, "Unauthorized - No token");

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.user = decoded; // { id, companyId, role }
  req.companyId = decoded.companyId;
  next();
});

export default protect;
