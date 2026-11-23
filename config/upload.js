const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.join(__dirname, "uploads");

// 저장 확장자는 검사한 MIME 타입으로 정한다 (파일 이름을 그대로 믿지 않음)
const EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
};

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
    cb(null, uploadDir);
    },

filename: (req, file, cb) => {
    const extension = EXTENSIONS[file.mimetype] || ".jpg";

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