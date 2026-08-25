import itemModel from "./item.model.js";
import ApiError from "../../../utils/ApiError.js";

/** Must match the unique name index on the Item model. */
export const ITEM_NAME_COLLATION = { locale: "en", strength: 3 };

export const assertUniqueItemName = async (companyId, name, excludeId) => {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new ApiError(400, "Product name is required");

  const filter = { companyId, name: trimmed };
  if (excludeId) filter._id = { $ne: excludeId };

  const exists = await itemModel
    .findOne(filter)
    .collation(ITEM_NAME_COLLATION)
    .select("_id name")
    .lean();

  if (exists) {
    throw new ApiError(
      409,
      `Product name "${trimmed}" already exists (matches "${exists.name}")`
    );
  }

  return trimmed;
};

export const syncItemIndexes = async () => {
  const collection = itemModel.collection;
  const indexes = await collection.indexes();

  // Remove old companyId+name unique index if collation differs (strength 2 → 3)
  for (const index of indexes) {
    const keys = index.key || {};
    const isNameIndex =
      keys.companyId === 1 &&
      keys.name === 1 &&
      Object.keys(keys).length === 2;

    if (!isNameIndex || index.name === "_id_") continue;

    const strength = index.collation?.strength;
    if (strength !== ITEM_NAME_COLLATION.strength) {
      await collection.dropIndex(index.name);
    }
  }

  await itemModel.syncIndexes();
};
