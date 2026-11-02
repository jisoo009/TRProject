const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
    cb(null, uploadDir);
    },

filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const filename =
        `${Date.now()}-${crypto.randomUUID()}${extension}`;

    cb(null, filename);
    }
});

// 사진 업로드 제한
const upload = multer({
    storage: storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

fileFilter: (req, file, cb) => {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(
        new Error("JPG, PNG, WEBP 형식의 사진만 업로드할 수 있습니다.")
        );
    }
    } 
});

module.exports = {
    upload,
    uploadDir
};