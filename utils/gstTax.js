export const DEFAULT_GST_PERCENT = 18;

const STATE_NAME_TO_CODE = {
  "andhra pradesh": "37",
  "arunachal pradesh": "12",
  assam: "18",
  bihar: "10",
  chhattisgarh: "22",
  goa: "30",
  gujarat: "24",
  haryana: "06",
  "himachal pradesh": "02",
  jharkhand: "20",
  karnataka: "29",
  kerala: "32",
  "madhya pradesh": "23",
  maharashtra: "27",
  "tamil nadu": "33",
  telangana: "36",
  "uttar pradesh": "09",
  "west bengal": "19",
  delhi: "07",
  rajasthan: "08",
  punjab: "03",
  uttarakhand: "05",
  odisha: "21",
  "jammu and kashmir": "01",
  ladakh: "38",
  puducherry: "34",
  chandigarh: "04",
  lakshadweep: "31",
  "andaman and nicobar islands": "35",
};

export const normalizeStateCode = (code) => {
  const value = String(code ?? "").trim();
  if (!value) return "";
  return value.padStart(2, "0");
};

export const stateCodeFromGstin = (gstin) => {
  const value = String(gstin ?? "").trim().toUpperCase();
  if (value.length < 2) return "";
  return normalizeStateCode(value.slice(0, 2));
};

export const stateCodeFromStateName = (stateName) => {
  const key = String(stateName ?? "").trim().toLowerCase();
  if (!key) return "";
  return normalizeStateCode(STATE_NAME_TO_CODE[key] || "");
};

export const resolvePartyStateCode = (party) => {
  const fromAddress = normalizeStateCode(party?.address?.stateCode);
  if (fromAddress) return fromAddress;

  const fromGstin = stateCodeFromGstin(party?.gstin);
  if (fromGstin) return fromGstin;

  return stateCodeFromStateName(party?.address?.state);
};

export const resolveGstSupplyType = (supplierStateCode, placeOfSupplyStateCode) => {
  const supplier = normalizeStateCode(supplierStateCode);
  const supply = normalizeStateCode(placeOfSupplyStateCode);
  if (!supplier || !supply) return "intra";
  return supplier === supply ? "intra" : "inter";
};

export const calculateLineGst = ({
  taxableValue,
  taxPercent,
  supplierStateCode,
  placeOfSupplyStateCode,
}) => {
  const taxable = Number(taxableValue) || 0;
  const rate = Number(taxPercent) || DEFAULT_GST_PERCENT;

  if (taxable <= 0 || rate <= 0) {
    return { cgst: 0, sgst: 0, igst: 0, supplyType: "intra" };
  }

  const supplyType = resolveGstSupplyType(supplierStateCode, placeOfSupplyStateCode);

  if (supplyType === "inter") {
    const igst = Number(((taxable * rate) / 100).toFixed(2));
    return { cgst: 0, sgst: 0, igst, supplyType: "inter" };
  }

  const halfRate = rate / 2;
  const sgst = Number(((taxable * halfRate) / 100).toFixed(2));
  const cgst = Number(((taxable * halfRate) / 100).toFixed(2));
  return { cgst, sgst, igst: 0, supplyType: "intra" };
};
