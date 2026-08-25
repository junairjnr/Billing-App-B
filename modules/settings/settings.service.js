import RolePermission from "./rolePermission.model.js";
import Company from "../company/company.model.js";
import ApiError from "../../utils/ApiError.js";
import {
  ALL_VIEW_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  MANAGED_ROLES,
  SUPER_ADMIN_SETTINGS,
  VIEW_PERMISSIONS,
} from "./permissions.constants.js";

const mapToObject = (views) => {
  if (!views) return {};
  if (views instanceof Map) return Object.fromEntries(views.entries());
  return { ...views };
};

const normalizeViews = (views = {}, fallback = {}) =>
  Object.fromEntries(
    ALL_VIEW_KEYS.map((key) => [
      key,
      views[key] !== undefined ? Boolean(views[key]) : Boolean(fallback[key]),
    ])
  );

export const seedDefaultPermissions = async (companyId) => {
  const docs = MANAGED_ROLES.map((role) => ({
    companyId,
    role,
    views: normalizeViews(DEFAULT_ROLE_PERMISSIONS[role]),
  }));
  await RolePermission.insertMany(docs);
};

export const getEffectivePermissions = async (companyId, role) => {
  if (role === "super_admin") {
    return {
      ...Object.fromEntries(ALL_VIEW_KEYS.map((key) => [key, true])),
      ...SUPER_ADMIN_SETTINGS,
      role,
      isSuperAdmin: true,
    };
  }

  const doc = await RolePermission.findOne({ companyId, role }).lean();
  const fallback = DEFAULT_ROLE_PERMISSIONS[role] || {};
  const views = normalizeViews(mapToObject(doc?.views), fallback);

  return {
    ...views,
    role,
    isSuperAdmin: false,
  };
};

export const getPermissionCatalog = () => ({
  roles: MANAGED_ROLES,
  permissions: VIEW_PERMISSIONS,
});

export const getAllRolePermissions = async (companyId) => {
  const docs = await RolePermission.find({ companyId }).lean();
  const byRole = Object.fromEntries(
    MANAGED_ROLES.map((role) => {
      const doc = docs.find((d) => d.role === role);
      const fallback = DEFAULT_ROLE_PERMISSIONS[role] || {};
      return [
        role,
        normalizeViews(mapToObject(doc?.views), fallback),
      ];
    })
  );

  return {
    ...getPermissionCatalog(),
    permissionsByRole: byRole,
  };
};

export const updateRolePermissions = async (companyId, role, views) => {
  if (!MANAGED_ROLES.includes(role)) {
    throw new ApiError(400, "Invalid role");
  }

  const normalized = normalizeViews(views);
  const doc = await RolePermission.findOneAndUpdate(
    { companyId, role },
    { views: normalized },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return {
    role,
    views: normalizeViews(mapToObject(doc.views)),
  };
};

export const getCompanySettings = async (companyId) => {
  const company = await Company.findById(companyId).select("-__v");
  if (!company) throw new ApiError(404, "Company not found");
  return company;
};

export const updateCompanySettings = async (companyId, payload) => {
  const company = await Company.findById(companyId);
  if (!company) throw new ApiError(404, "Company not found");

  const { name, code, email, phone, address, logo, plan, gstin, terms } = payload;

  if (name && name !== company.name) {
    const exists = await Company.findOne({ name, _id: { $ne: companyId } });
    if (exists) throw new ApiError(409, "Company name already exists");
    company.name = name;
  }

  if (code && code.toUpperCase() !== company.code) {
    const exists = await Company.findOne({
      code: code.toUpperCase(),
      _id: { $ne: companyId },
    });
    if (exists) throw new ApiError(409, "Company code already exists");
    company.code = code.toUpperCase();
  }

  if (email !== undefined) company.email = email;
  if (phone !== undefined) company.phone = phone;
  if (address !== undefined) company.address = address;
  if (logo !== undefined) company.logo = logo;
  if (plan !== undefined) company.plan = plan;
  if (gstin !== undefined) company.gstin = gstin;
  if (terms !== undefined) company.terms = terms;

  await company.save();
  return company;
};

export const canView = (permissions, key) => {
  if (!permissions) return false;
  if (permissions.isSuperAdmin) return true;
  return Boolean(permissions[key]);
};
