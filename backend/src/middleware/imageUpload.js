import multer from "multer";

export const maxImageSize = 5 * 1024 * 1024;

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageSize,
    files: 1,
    fields: 0,
    parts: 1,
  },
}).single("image");
