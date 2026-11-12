
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");

const { uploadDir } = require("./config/upload");
const pool = require("./db");

const app = express();
const PORT = 3000;

// 기본 미들웨어
app.use(express.json());

// 세션 설정
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 3
        }
    })
);

// HTML, CSS, JavaScript 제공
app.use(express.static(path.join(__dirname, "public")));

// 업로드된 사진 제공
app.use("/uploads", express.static(uploadDir));

// 서버 테스트
app.get("/api/test", (req, res) => {
    res.json({
        message: "Time Remember 서버가 정상적으로 작동합니다!"
    });
});

// API 라우터 연결
app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/users"));
app.use("/api", require("./routes/rooms"));
app.use("/api", require("./routes/appointments"));
app.use("/api", require("./routes/photos"));

// Multer 및 기타 오류 처리
app.use((error, req, res, next) => {
    if (error.name === "MulterError") {
        if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
            message: "사진은 5MB 이하만 업로드할 수 있습니다."
        });
    }

    return res.status(400).json({
        message: "사진 업로드에 실패했습니다."
    });
    }

    if (
        error.message ===
        "JPG, PNG, WEBP 형식의 사진만 업로드할 수 있습니다."
    ) {
        return res.status(400).json({
        message: error.message
        });
    }

    console.error("서버 오류:", error);

    res.status(500).json({
        message: "서버 내부 오류가 발생했습니다."
    });
});

// 서버 실행 (테이블 준비가 끝난 뒤에 시작)
pool.initTables()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`서버 실행 주소: http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error("DB 초기화 실패 (.env의 DB 설정을 확인해 주세요):", error.message);
        process.exit(1);
    });
