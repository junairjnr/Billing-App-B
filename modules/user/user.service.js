const createUser = async ({ companyId, branchId, createdBy, name, email, role, password }) => {
  const exists = await User.findOne({ email });
  if (exists) throw new ApiError(409, "Email already in use");

  const user = await User.create({
    companyId,
    branchId,    // ← required now
    createdBy,
    name,
    email,
    password,
    role,
    isVerified: true,
  });

  user.password = undefined;
  return user;
};

const getCompanyUsers = async (companyId, branchId, role) => {
  const filter = { companyId };
  if (branchId) filter.branchId = branchId; // admin sees all, manager sees own branch
  return User.find(filter)
    .select("-password -inviteToken -inviteTokenExpiry")
    .populate("branchId", "name code")
    .sort({ createdAt: -1 });
};