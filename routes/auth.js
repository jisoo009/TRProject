const express = require("express");
const pool = require("../db");
const bcrypt = require("bcrypt");

const router = express.Router();



//회원가입
router.post("/signup", async (req, res) => {
    try {
        const nickname = typeof req.body.nickname === "string" ? req.body.nickname.trim() : "";
        const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
        const password = typeof req.body.password === "string" ? req.body.password : "";
        if (!nickname || !email || !password) {
        return res.status(400).json({
        message: "모든 항목을 입력해 주세요."
        });
    }

    if (nickname.length > 50 || email.length > 255) {
        return res.status(400).json({
            message: "닉네임 또는 이메일이 너무 깁니다."
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            message: "올바른 이메일을 입력해 주세요."
        });
    }
    if (
        password.length < 8 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        return res.status(400).json({
        message: "비밀번호는 8자 이상, UTF-8 기준 72바이트 이하여야 합니다."
        });
    }

    const [existingUsers] = await pool.query(
        "SELECT user_id FROM users WHERE email = ?",
        [email]
    );

    if (existingUsers.length > 0) {
        return res.status(409).json({
            message: "이미 가입된 이메일입니다."
        });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
        `INSERT INTO users (email, password_hash, nickname)
        VALUES (?, ?, ?)`,
        [email, passwordHash, nickname]
    );

    res.status(201).json({
        message: "회원가입이 완료되었습니다."
    });

    } catch (error) {
        console.error("회원가입 실패:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
        message: "이미 사용 중인 이메일입니다."
        });
    }

    res.status(500).json({
        message: "회원가입 중 오류가 발생했습니다."
    });
    }
});

//로그인
router.post("/login", async (req, res) => {
    try {
        const email =
        typeof req.body.email === "string"
            ? req.body.email.trim().toLowerCase()
            : "";

    const password =
        typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!email || !password) {
        return res.status(400).json({
            message: "이메일과 비밀번호를 입력해 주세요."
        });
    }

    const [users] = await pool.query(
        `SELECT user_id, email, nickname, password_hash
        FROM users
        WHERE email = ?`,
        [email]
    );

    if (users.length === 0) {
        return res.status(401).json({
        message: "이메일 또는 비밀번호가 올바르지 않습니다."
        });
    }
    const user = users[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
        return res.status(401).json({
            message: "이메일 또는 비밀번호가 올바르지 않습니다."
        });
    }

    req.session.regenerate((error) => {
        if (error) {
            console.error("세션 생성 실패:", error.message);

            return res.status(500).json({
                message: "로그인 처리 중 오류가 발생했습니다."
            });
        }

        req.session.userId = user.user_id;

        req.session.save((saveError) => {
            if (saveError) {
                console.error("세션 저장 실패:", saveError.message);

                return res.status(500).json({
                    message: "로그인 처리 중 오류가 발생했습니다."
            });
        }
        
        res.json({
            message: "로그인에 성공했습니다.",
            user: {
                userId: user.user_id,
                email: user.email,
                nickname: user.nickname
                }
            });
        });
    });
} catch (error) {
    console.error("로그인 실패:", error.message);

    res.status(500).json({
        message: "로그인 처리 중 오류가 발생했습니다."
    }); 

}

});

//로그아웃
router.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error("로그아웃 실패:", error.message);

            return res.status(500).json({
                message: "로그아웃 중 오류가 발생했습니다."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            message: "로그아웃되었습니다."
        });
    });
});

module.exports = router;
