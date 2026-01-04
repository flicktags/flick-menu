// utils/cloudinary.js
import { v2 as cloudinary } from "cloudinary";

// ✅ Put your values here (manual)
const CLOUDINARY_CLOUD_NAME = "diwspe6yi";
const CLOUDINARY_API_KEY = "457834299199625";
const CLOUDINARY_API_SECRET = "cOt4I5PxEZ7fPWOI0vmzXYzLt6o";

// ✅ Your upload folder (same as Flutter folder you use)
export const CLOUDINARY_FOLDER = "FlickMenu-Item-Image"; 
// If you don't want folder safety check, set it to "".

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

export default cloudinary;
