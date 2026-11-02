
const express = require("express");
const pool = require("../db");
const requireLogin = require("../middleware/auth");
const { isRoomMember } = require("./rooms");

const router = express.Router();

// 특정 방의 약속 목록 조회
router.get(
    "/rooms/:roomId/appointments",
    requireLogin,
    async (req, res) => {
        const roomId = Number(req.params.roomId);

    if (!Number.isInteger(roomId) || roomId < 1) {
        return res.status(400).json({
            message: "올바르지 않은 방 번호입니다."
        });
    }

    try {
        const member = await isRoomMember(
        roomId,
        req.session.userId
        );

        if (!member) {
            return res.status(403).json({
                message: "이 방에 접근할 권한이 없습니다."
            });
        }

        const [appointments] = await pool.query(
            `SELECT
            appointment_id,
            title,
            start_at,
            place,
            description,
            status,
            creator_user_id
            FROM appointments
            WHERE room_id = ?
            ORDER BY start_at ASC`,
            [roomId]
        );

        res.json(appointments);

    } catch (error) {
        console.error("약속 조회 실패:", error.message);

        res.status(500).json({
            message: "약속 목록을 불러오지 못했습니다."
        });
    }
    }
);

// 약속 등록
router.post(
    "/rooms/:roomId/appointments",
    requireLogin,
    async (req, res) => {
        const roomId = Number(req.params.roomId);

        const {
        title,
        start_at,
        place,
        description = ""
        } = req.body;

        if (!Number.isInteger(roomId) || roomId < 1) {
        return res.status(400).json({
            message: "올바르지 않은 방 번호입니다."
        });
    }

    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 200
    ) {
        return res.status(400).json({
            message: "약속 제목을 입력해 주세요."
        });
    }

    if (
        typeof start_at !== "string" ||
        !start_at.trim() ||
        Number.isNaN(new Date(start_at).getTime())
    ) {
        return res.status(400).json({
            message: "올바른 날짜와 시간을 입력해 주세요."
        });
    }

    if (
        typeof place !== "string" ||
        place.trim().length > 255
    ) {
        return res.status(400).json({
            message: "장소를 확인해 주세요."
        });
    }

    if (
        typeof description !== "string" ||
        description.length > 2000
    ) {
        return res.status(400).json({
            message: "설명은 2000자 이내로 입력해 주세요."
        });
    }

    try {
        const member = await isRoomMember(
            roomId,
            req.session.userId
        );

        if (!member) {
            return res.status(403).json({
            message: "이 방에 접근할 권한이 없습니다."
            });
        }

        const [result] = await pool.query(
            `INSERT INTO appointments
            (room_id, creator_user_id, title, start_at,
            place, description, status)
            VALUES (?, ?, ?, ?, ?, ?, 'planned')`,
        [
            roomId,
            req.session.userId,
            title.trim(),
            start_at,
            place.trim(),
            description.trim()
        ]
        );

        res.status(201).json({
            message: "약속이 등록되었습니다.",
            appointment_id: result.insertId
        });

    } catch (error) {
        console.error("약속 등록 실패:", error.message);

        res.status(500).json({
            message: "약속을 등록하지 못했습니다."
        });
        }
    }
);

module.exports = router;
