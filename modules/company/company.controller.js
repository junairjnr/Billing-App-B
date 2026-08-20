import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import companyService from "./company.service.js";

const getCompanyDetails = asyncHandler(async (req, res) => {
  const data = await companyService.getCompanyDetails(req.params.id);
  res.json(new ApiResponse(200, data));
});

const getAllCompanies = asyncHandler(async (req, res) => {
  const data = await companyService.getAllCompanies();
  res.json(new ApiResponse(200, data));
});

const updateCompanyDetails = asyncHandler(async (req, res) => {
  const data = await companyService.updateCompanyDetails(req.params.id, req.body);
  res.json(new ApiResponse(200, data, "Company updated"));
});

export default { getCompanyDetails, getAllCompanies, updateCompanyDetails };
