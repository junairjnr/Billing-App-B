export const SLNO_KEY = "slno";

export const SLNO_COLUMN = {
  key: SLNO_KEY,
  header: "Sl No",
  default: true,
  virtual: true,
  width: 8,
  get: (_row, index) => index + 1,
};

/**
 * Column keys the UI sends, mapped to the config keys that can serve them in
 * priority order. Keeps one Excel column per on-screen column.
 */
const KEY_ALIASES = {
  date: ["date", "purchaseDate", "invoiceDate", "entryDate", "returnDate", "createdAt"],
  type: ["type", "salesType", "accountType", "entryType", "movementType"],
  name: ["name", "accountName"],
  account: ["accountName"],
  customer: ["customer", "customerSnapshot", "name"],
  vendor: ["vendor", "vendorSnapshot", "name"],
  party: ["party", "partyName"],
  item: ["item", "itemName"],
  itemName: ["itemName", "item"],
  originalInvoice: ["originalInvoice", "originalInvoiceNo"],
  originalInvoiceNo: ["originalInvoiceNo", "originalInvoice"],
  tax: ["tax", "totalTax"],
  debit: ["debit", "totalDebit", "debitBalance"],
  credit: ["credit", "totalCredit", "creditBalance"],
  amount: ["amount", "totalAmount", "grandTotal"],
  grandTotal: ["grandTotal", "amount"],
  outstanding: ["outstanding", "balance"],
  balance: ["balance", "balanceAmount", "balanceQty"],
  mode: ["mode", "paymentMode"],
  reference: ["reference", "referenceNo"],
  source: ["source", "referenceType"],
  movement: ["movement", "movementType"],
  receiptNo: ["receiptNo", "voucherNo"],
  paymentNo: ["paymentNo", "voucherNo"],
  payment: ["payment", "paymentStatus"],
  partyType: ["partyType", "type"],
  unit: ["unit", "uom"],
};

const findConfigColumn = (config, key) => {
  const candidates = [key, ...(KEY_ALIASES[key] ?? [])];

  for (const candidate of candidates) {
    const col = config.columns.find((c) => c.key === candidate);
    if (col) return col;
  }

  return null;
};

const normalizeKey = (key) => {
  if (key === "rowNum" || key === "#") return SLNO_KEY;
  return key;
};

/** Resolve selected column keys (from frontend) into export column defs, preserving order. */
export const resolveSelectedColumns = (config, selectedKeys) => {
  if (!selectedKeys?.length) {
    return config.columns.filter((col) => col.default !== false);
  }

  return selectedKeys
    .map((rawKey) => {
      const key = normalizeKey(rawKey);
      if (key === SLNO_KEY) return SLNO_COLUMN;
      return findConfigColumn(config, key);
    })
    .filter(Boolean);
};

/** Column metadata for GET /export/:type/columns — includes Sl No when supported. */
export const listColumnMetaWithSlNo = (config, { includeSlNo = true } = {}) => {
  const cols = config.columns.map(({ key, header, default: isDefault }) => ({
    key,
    label: header,
    default: isDefault !== false,
  }));

  if (!includeSlNo || cols.some((c) => c.key === SLNO_KEY)) {
    return cols;
  }

  return [{ key: SLNO_KEY, label: "Sl No", default: true }, ...cols];
};
