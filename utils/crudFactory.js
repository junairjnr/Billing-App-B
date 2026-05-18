import asyncHandler from "./asyncHandler.js";
import ApiResponse from "./ApiResponse.js";
import ApiError from "./ApiError.js";

const crudFactory = (Model) => ({
  getAll: asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, search = "", isActive } = req.query;
    const filter = { companyId: req.companyId };

    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) filter.name = { $regex: search, $options: "i" };

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Model.find(filter)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      Model.countDocuments(filter),
    ]);

    res.json(
      new ApiResponse(200, {
        data,
        total,
        page: Number(page),
        limit: Number(limit),
      })
    );
  }),

  getOne: asyncHandler(async (req, res) => {
    const doc = await Model.findOne({
      _id: req.params.id,
      companyId: req.companyId,
    });
    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, doc));
  }),

  create: asyncHandler(async (req, res) => {
    const doc = await Model.create({ ...req.body, companyId: req.companyId });
    res.status(201).json(new ApiResponse(201, doc, "Created successfully"));
  }),

  update: asyncHandler(async (req, res) => {
    const doc = await Model.findOneAndUpdate(
      { _id: req.params.id, companyId: req.companyId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, doc, "Updated successfully"));
  }),

  //   remove: asyncHandler(async (req, res) => {
  //     const doc = await Model.findOneAndUpdate(
  //       { _id: req.params.id, companyId: req.companyId },
  //       { isActive: false },
  //       { new: true }
  //     );
  remove: asyncHandler(async (req, res) => {
    const doc = await Model.findOneAndDelete({
      _id: req.params.id,
      companyId: req.companyId,
    });
    if (!doc) throw new ApiError(404, "Record not found");
    res.json(new ApiResponse(200, null, "Deleted successfully"));
  }),
});

export default crudFactory;
