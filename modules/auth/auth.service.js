import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../user/user.model.js";
import Company from "../company/company.model.js";
import ApiError from "../../utils/ApiError.js";

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

// Register = Create Company + Admin User (atomic)
const register = async ({
  companyName,
  companyEmail,
  name,
  email,
  password,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    console.log(
      "Checking if email already exists:",
      email,
      companyName,
      companyEmail,
      name,
      password
    );

    const existingUser = await User.findOne({ email });
    if (existingUser) throw new ApiError(409, "Email already registered");

    const [company] = await Company.create(
      [{ name: companyName, email: companyEmail }],
      { session }
    );

    const [user] = await User.create(
      [{ companyId: company._id, name, email, password, role: "admin" }],
      { session }
    );

    await session.commitTransaction();

    const token = generateToken({
      id: user._id,
      companyId: company._id,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      company,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password)))
    throw new ApiError(401, "Invalid email or password");

  if (!user.isActive) throw new ApiError(403, "Account is deactivated");

  const token = generateToken({
    id: user._id,
    companyId: user.companyId,
    role: user.role,
  });
  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    },
  };
};

export default { register, login };
