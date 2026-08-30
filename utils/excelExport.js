import ExcelJS from "exceljs";

export const buildWorkbook = async (rows, columns, sheetName = "Report") => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  // Use array-based rows so Excel only contains exactly the selected columns.
  // Keyed addRow() can leave trailing empty columns in the sheet grid.
  const headerRow = sheet.addRow(columns.map((col) => col.header));
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" },
  };

  for (const [index, row] of rows.entries()) {
    sheet.addRow(
      columns.map((col) => {
        if (col.key === "slno" || col.virtual) return index + 1;
        return col.get(row, index);
      })
    );
  }

  columns.forEach((col, index) => {
    sheet.getColumn(index + 1).width = col.width || Math.max(col.header.length + 4, 14);
  });

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
