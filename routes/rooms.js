
const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const requireLogin = require("../middleware/auth");

const router = express.Router();

// 특정 방의 멤버인지 확인
async function isRoomMember(roomId, userId) {
    const [rows] = await pool.query(
        `SELECT room_id
        FROM room_members
        WHERE room_id = ? AND user_id = ?`,
        [roomId, userId]
    );

    return rows.length > 0;
}

// 친구 방 목록 조회
router.get("/rooms", requireLogin, async (req, res) => {
    try {
    const [rooms] = await pool.query(
        `SELECT
        r.room_id,
        r.room_name,
        r.description,
        rm.role,
        r.created_at
        FROM rooms r
        JOIN room_members rm
            ON r.room_id = rm.room_id
        WHERE rm.user_id = ?
        ORDER BY r.created_at DESC`,
        [req.session.userId]
    );

    res.json(rooms);

    } catch (error) {
        console.error("방 목록 조회 실패:", error.message);

        res.status(500).json({
        message: "방 목록을 불러오지 못했습니다."
    });
    }
});

// 친구 방 만들기
router.post("/rooms", requireLogin, async (req, res) => {
    const roomName =
    typeof req.body.room_name === "string"
    ? req.body.room_name.trim()
    : "";

    const description =
    typeof req.body.description === "string"
    ? req.body.description.trim()
    : "";

    if (!roomName || roomName.length > 100) {
        return res.status(400).json({
        message: "방 이름을 입력해 주세요. (최대 100자)"
    });
    }

    if (description.length > 500) {
    return res.status(400).json({
        message: "방 설명은 500자 이내로 입력해 주세요."
    });
    }

    let connection;

    try {
    connection = await pool.getConnection();

    await connection.beginTransaction();

    const inviteCode = crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase();

    const [result] = await connection.query(
        `INSERT INTO rooms
        (owner_user_id, room_name, description, invite_code)
        VALUES (?, ?, ?, ?)`,
        [
        req.session.userId,
        roomName,
        description,
        inviteCode
        ]
    );

    await connection.query(
        `INSERT INTO room_members
        (room_id, user_id, role)
        VALUES (?, ?, 'owner')`,
        [result.insertId, req.session.userId]
    );

    await connection.commit();

    res.status(201).json({
        message: "방이 만들어졌습니다.",
        room: {
            room_id: result.insertId,
            room_name: roomName,
            description,
            invite_code: inviteCode
        }
    });

    } catch (error) {
    if (connection) {
        await connection.rollback();
    }

    console.error("방 생성 실패:", error.message);

    res.status(500).json({
        message: "방을 만들지 못했습니다."
    });

    } finally {
    if (connection) {
        connection.release();
    }
        }
});

// 초대 코드로 방 참여하기
router.post("/rooms/join", requireLogin, async (req, res) => {
    const inviteCode =
    typeof req.body.invite_code === "string"
    ? req.body.invite_code.trim().toUpperCase()
    : "";

    if (!inviteCode) {
        return res.status(400).json({
        message: "초대 코드를 입력해 주세요."
    });
    }

    try {
        const [rooms] = await pool.query(
        `SELECT room_id, room_name
        FROM rooms
        WHERE invite_code = ?`,
        [inviteCode]
    );

    if (rooms.length === 0) {
        return res.status(404).json({
            message: "초대 코드를 찾을 수 없습니다."
        });
    }

    const room = rooms[0];

    await pool.query(
        `INSERT IGNORE INTO room_members
        (room_id, user_id, role)
        VALUES (?, ?, 'member')`,
        [room.room_id, req.session.userId]
    );

    res.json({
        message: "방에 참여했습니다.",
        room
    });

    } catch (error) {
        console.error("방 참여 실패:", error.message);

        res.status(500).json({
        message: "방에 참여하지 못했습니다."
        });
    }
});

// 다른 라우터에서도 사용할 수 있도록 내보내기
module.exports = router;
module.exports.isRoomMember = isRoomMember;
