import ExcelJS from "exceljs";
import { parseMoneyValue } from "./formatMoney.js";

const BORDER_COLOR = "FFCCCCCC";

const cellBorder = {
  top: { style: "thin", color: { argb: BORDER_COLOR } },
  left: { style: "thin", color: { argb: BORDER_COLOR } },
  bottom: { style: "thin", color: { argb: BORDER_COLOR } },
  right: { style: "thin", color: { argb: BORDER_COLOR } },
};

const QTY_KEY_PATTERN = /qty|quantity/i;
const PERCENT_KEY_PATTERN = /percent/i;

const MONEY_KEY_PATTERN =
  /amount|total|balance|debit|credit|price|rate|value|stock|sgst|cgst|igst|paid|received|outstanding|net|taxable|subtotal|bill|discount|round/i;

const NUMERIC_KEY_PATTERN = new RegExp(
  `${MONEY_KEY_PATTERN.source}|${QTY_KEY_PATTERN.source}|${PERCENT_KEY_PATTERN.source}|slno|round`,
  "i"
);

const CURRENCY_NUM_FMT = '"Rs. "#,##0.00';
const QTY_NUM_FMT = "#,##0.##";
const PERCENT_NUM_FMT = "#,##0.00";
const SLNO_NUM_FMT = "0";

const isSlNoColumn = (col) => col.key === "slno" || col.virtual;
const isQtyColumn = (col) => QTY_KEY_PATTERN.test(col.key);
const isPercentColumn = (col) => PERCENT_KEY_PATTERN.test(col.key);

const isMoneyColumn = (col) => {
  if (isSlNoColumn(col)) return false;
  if (isQtyColumn(col) || isPercentColumn(col)) return false;
  if (col.key === "tax" || col.key === "totalTax") return true;
  return MONEY_KEY_PATTERN.test(col.key);
};

const isNumericColumn = (col, value) => {
  if (isSlNoColumn(col)) return true;
  if (typeof value === "number") return true;
  return NUMERIC_KEY_PATTERN.test(col.key);
};

const resolveCellValue = (col, rawValue) => {
  if (isSlNoColumn(col)) return rawValue;
  if (isMoneyColumn(col) || isNumericColumn(col, rawValue)) {
    return parseMoneyValue(rawValue);
  }
  return rawValue;
};

const getCellAlignment = (col, value, isHeader) => {
  if (isHeader) {
    return { vertical: "middle", horizontal: "center", wrapText: false };
  }

  if (isSlNoColumn(col)) {
    return { vertical: "middle", horizontal: "center", wrapText: false };
  }

  if (isMoneyColumn(col) || isQtyColumn(col) || isPercentColumn(col)) {
    return { vertical: "middle", horizontal: "right", wrapText: false };
  }

  if (isNumericColumn(col, value)) {
    return { vertical: "middle", horizontal: "right", wrapText: false };
  }

  return { vertical: "middle", horizontal: "left", wrapText: false };
};

const getCellNumFmt = (col) => {
  if (isSlNoColumn(col)) return SLNO_NUM_FMT;
  if (isMoneyColumn(col)) return CURRENCY_NUM_FMT;
  if (isQtyColumn(col)) return QTY_NUM_FMT;
  if (isPercentColumn(col)) return PERCENT_NUM_FMT;
  return "#,##0.00";
};

const displayLength = (value, col) => {
  if (value == null) return 0;
  if (typeof value === "number") {
    if (isSlNoColumn(col)) return String(Math.trunc(value)).length;
    if (isMoneyColumn(col)) return `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.length;
    return String(value).length;
  }
  return String(value).length;
};

const computeColumnWidth = (col, header, cellValues) => {
  if (isSlNoColumn(col)) return col.width || 8;

  const lengths = [
    String(header).length,
    ...cellValues.map((value) => displayLength(value, col)),
  ];
  const maxLen = Math.max(...lengths, 0);
  const minWidth = col.width || 12;

  return Math.min(Math.max(maxLen + 2, minWidth), 60);
};

const styleSheet = (sheet, columns, dataRows) => {
  const lastRow = sheet.rowCount;
  const columnCount = columns.length;

  for (let colIndex = 1; colIndex <= columnCount; colIndex += 1) {
    const col = columns[colIndex - 1];
    const values = dataRows.map((row) => row[colIndex - 1]);
    sheet.getColumn(colIndex).width = computeColumnWidth(col, col.header, values);
  }

  for (let rowIndex = 1; rowIndex <= lastRow; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const isHeader = rowIndex === 1;

    for (let colIndex = 1; colIndex <= columnCount; colIndex += 1) {
      const cell = row.getCell(colIndex);
      const col = columns[colIndex - 1];

      cell.border = cellBorder;
      cell.alignment = getCellAlignment(col, cell.value, isHeader);

      if (isHeader) {
        continue;
      }

      if (typeof cell.value !== "number") continue;

      if (isSlNoColumn(col) || isMoneyColumn(col) || isQtyColumn(col) || isPercentColumn(col)) {
        cell.numFmt = getCellNumFmt(col);
      } else if (isNumericColumn(col, cell.value)) {
        cell.numFmt = "#,##0.00";
      }
    }

    row.height = isHeader ? 22 : undefined;
    row.commit();
  }

  sheet.views = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];
};

export const buildWorkbook = async (rows, columns, sheetName = "Report") => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((col) => ({
    key: col.key,
    width: col.width || 12,
  }));

  const headerRow = sheet.addRow(columns.map((col) => col.header));
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" },
  };

  const dataRows = [];

  for (const [index, row] of rows.entries()) {
    const values = columns.map((col) => {
      if (isSlNoColumn(col)) return index + 1;
      return resolveCellValue(col, col.get(row, index));
    });
    dataRows.push(values);
    sheet.addRow(values);
  }

  styleSheet(sheet, columns, dataRows);

  return workbook.xlsx.writeBuffer();
};

export const sendExcel = async (res, rows, columns, filename, sheetName) => {
  const buffer = await buildWorkbook(rows, columns, sheetName);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  res.send(Buffer.from(buffer));
};

export const pickColumns = (allColumns, selectedKeys) => {
  if (!selectedKeys?.length) return allColumns;
  const set = new Set(selectedKeys);
  return allColumns.filter((col) => set.has(col.key));
};
