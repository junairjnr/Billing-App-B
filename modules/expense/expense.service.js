import Expense from "./expense.model.js";
import FinancialYear from "../financialYear/financialYear.model.js";
import ApiError from "../../utils/ApiError.js";
import { getFYDocumentCode, getDocumentSequence } from "../../utils/fyCode.js";

const baseFilter = ({ companyId, branchId, financialYearId }) => ({
  companyId,
  branchId,
  financialYearId,
  isActive: true,
  status: { $ne: "cancelled" },
});

export const generateExpenseNo = async (companyId, financialYearId) => {
  const fy = await FinancialYear.findById(financialYearId);
  if (!fy) throw new ApiError(404, "Financial year not found");

  const prefix = `EXP-${getFYDocumentCode(fy.label)}`;
  const last = await Expense.findOne(
    { companyId, financialYearId },
    { expenseNo: 1 },
    { sort: { createdAt: -1 } }
  );

  if (!last) return `${prefix}-0001`;
  const lastNo = getDocumentSequence(last.expenseNo);
  return `${prefix}-${String(lastNo + 1).padStart(4, "0")}`;
};

export const createExpense = async (ctx, body) => {
  const expenseNo = await generateExpenseNo(ctx.companyId, ctx.financialYearId);

  return Expense.create({
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    financialYearId: ctx.financialYearId,
    expenseNo,
    date: body.date,
    category: body.category,
    title: body.title,
    amount: Number(body.amount),
    paymentMode: body.paymentMode || "cash",
    bankAccountId: body.bankAccountId || undefined,
    referenceNo: body.referenceNo,
    notes: body.notes,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
};

export const updateExpense = async (ctx, id, body) => {
  const doc = await Expense.findOne({
    _id: id,
    ...baseFilter(ctx),
  });

  if (!doc) throw new ApiError(404, "Expense not found");

  if (body.date !== undefined) doc.date = body.date;
  if (body.category !== undefined) doc.category = body.category;
  if (body.title !== undefined) doc.title = body.title;
  if (body.amount !== undefined) doc.amount = Number(body.amount);
  if (body.paymentMode !== undefined) doc.paymentMode = body.paymentMode;
  if (body.bankAccountId !== undefined) doc.bankAccountId = body.bankAccountId || undefined;
  if (body.referenceNo !== undefined) doc.referenceNo = body.referenceNo;
  if (body.notes !== undefined) doc.notes = body.notes;
  doc.updatedBy = ctx.userId;

  await doc.save();
  return doc;
};

export const deleteExpense = async (ctx, id) => {
  const doc = await Expense.findOne({
    _id: id,
    ...baseFilter(ctx),
  });

  if (!doc) throw new ApiError(404, "Expense not found");

  doc.status = "cancelled";
  doc.isActive = false;
  doc.updatedBy = ctx.userId;
  await doc.save();
  return doc;
};

export const getExpense = async (ctx, id) => {
  const doc = await Expense.findOne({
    _id: id,
    companyId: ctx.companyId,
    financialYearId: ctx.financialYearId,
    isActive: { $ne: false },
  }).lean();

  if (!doc) throw new ApiError(404, "Expense not found");
  return doc;
};

export const listExpenses = async (ctx, query) => {
  const { category, paymentMode, dateFrom, dateTo, search, page = 1, limit = 20 } = query;
  const filter = baseFilter(ctx);

  if (category) filter.category = category;
  if (paymentMode) filter.paymentMode = paymentMode;
  if (search) {
    filter.$or = [
      { expenseNo: { $regex: search, $options: "i" } },
      { title: { $regex: search, $options: "i" } },
    ];
  }
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filter.date.$lte = end;
    }
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Expense.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Expense.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / Number(limit)) || 1;

  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages,
    hasNext: Number(page) < totalPages,
  };
};
