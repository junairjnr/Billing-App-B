import fs from "fs";
import path from "path";
import ApiError from "../../utils/ApiError.js";

const MAX_ATTACHMENTS = 10;

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function getPurchaseUploadDir(companyId) {
  return path.join(process.cwd(), "uploads", String(companyId), "purchase");
}

export function ensureUploadDir(companyId) {
  const dir = getPurchaseUploadDir(companyId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolvePurchaseUploadFile(companyId, fileName) {
  const safeName = path.basename(String(fileName || ""));
  if (!safeName) return null;

  const dir = path.resolve(getPurchaseUploadDir(companyId));
  const fullPath = path.resolve(dir, safeName);

  if (!fullPath.startsWith(`${dir}${path.sep}`) && fullPath !== dir) {
    return null;
  }

  return fullPath;
}

export function normalizeAttachments(companyId, attachments) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .slice(0, MAX_ATTACHMENTS)
    .map((item) => {
      if (!item?.fileName) return null;

      const fileName = path.basename(String(item.fileName));
      const fullPath = resolvePurchaseUploadFile(companyId, fileName);
      if (!fullPath || !fs.existsSync(fullPath)) return null;

      return {
        fileName,
        originalName: String(item.originalName || fileName).slice(0, 255),
        mimeType: String(item.mimeType || "application/octet-stream").slice(0, 127),
        size: Number(item.size) || 0,
        uploadedAt: item.uploadedAt ? new Date(item.uploadedAt) : new Date(),
      };
    })
    .filter(Boolean);
}

export function deletePurchaseUploadFile(companyId, fileName) {
  const filePath = resolvePurchaseUploadFile(companyId, fileName);
  if (!filePath || !fs.existsSync(filePath)) return false;

  fs.unlinkSync(filePath);
  return true;
}

const matchesMagic = (buf, mimeType) => {
  if (mimeType === "application/pdf") {
    return buf.slice(0, 5).toString("ascii") === "%PDF-";
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  }
  if (mimeType === "image/gif") {
    const head = buf.slice(0, 6).toString("ascii");
    return head === "GIF87a" || head === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      buf.slice(0, 4).toString("ascii") === "RIFF" &&
      buf.slice(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
};

/** Reject uploads whose bytes do not match the declared MIME type. */
export function assertFileMagicMatchesMime(filePath, mimeType) {
  if (!filePath || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ApiError(400, "Invalid file type");
  }
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    if (!matchesMagic(buf.subarray(0, bytesRead), mimeType)) {
      throw new ApiError(400, "File content does not match its type");
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function sanitizeDownloadFileName(name, fallback) {
  const base = path.basename(String(name || fallback || "download"));
  return base.replace(/[\r\n\x00-\x1f"\\]/g, "_").slice(0, 200) || "download";
}
