
const express = require("express");
const pool = require("../db");
const requireLogin = require("../middleware/auth");

const router = express.Router();

// 전체 회원 목록 조회
router.get("/users", async (req, res) => {
    try {
        const [users] = await pool.query(
        "SELECT user_id, email, nickname FROM users"
    );

    res.json(users);

    } catch (error) {
        console.error("회원 조회 실패:", error.message);

        res.status(500).json({
            message: "회원 정보를 불러오지 못했습니다."
        });
    }
});

// 현재 로그인한 회원 확인
router.get("/me", requireLogin, async (req, res) => {
    try {
        const [users] = await pool.query(
        `SELECT user_id, email, nickname
        FROM users
        WHERE user_id = ?`,
        [req.session.userId]
    );

    if (users.length === 0) {
        return res.status(401).json({
            message: "회원 정보를 찾을 수 없습니다."
        });
    }

    res.json({
        user: users[0]
    });

    } catch (error) {
        console.error("회원 확인 실패:", error.message);

    res.status(500).json({
        message: "회원 정보를 확인하지 못했습니다."
    });
    }
});

module.exports = router;
