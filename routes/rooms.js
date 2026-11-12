const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const requireLogin = require("../middleware/auth");

const router = express.Router();

// 멤버별 구분 색상 (방장이 첫 번째, 이후 참여 순서대로)
const MEMBER_COLORS = [
    "#f5e960", // 노랑
    "#8ccbff", // 하늘
    "#8fe3a0", // 초록
    "#d8b8ff", // 라벤더
    "#ffb3c7", // 분홍
    "#ffc78a"  // 주황
];

// 헷갈리기 쉬운 글자(0, O, 1, I)를 뺀 6자리 랜덤 코드
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateInviteCode(length = 6) {
    const bytes = crypto.randomBytes(length);
    let code = "";

    for (let i = 0; i < length; i++) {
        code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    }

    return code;
}

function parseRoomId(value) {
    const roomId = Number(value);
    return Number.isInteger(roomId) && roomId > 0 ? roomId : null;
}

function isValidDateString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

// 방 참여 여부 확인 (appointments, photos 라우터에서도 사용)
async function isRoomMember(roomId, userId) {
    const [rows] = await pool.query(
        `SELECT room_id
        FROM room_members
        WHERE room_id = ? AND user_id = ?`,
        [roomId, userId]
    );

    return rows.length > 0;
}

// 내가 참여한 방 목록
router.get("/rooms", requireLogin, async (req, res) => {
    try {
        const [rooms] = await pool.query(
            `SELECT r.room_id,
                    IF(r.room_name = '', CONCAT('방 ', r.invite_code), r.room_name) AS room_name,
                    r.invite_code, rm.role, r.created_at
            FROM rooms r
            JOIN room_members rm ON r.room_id = rm.room_id
            WHERE rm.user_id = ?
            ORDER BY r.created_at DESC, r.room_id DESC`,
            [req.session.userId]
        );

        res.json(rooms);
    } catch (error) {
        console.error("방 목록 조회 실패:", error.message);
        res.status(500).json({ message: "방 목록을 불러오지 못했습니다." });
    }
});

// 플러스(+) 버튼: 이름 입력 없이 바로 방 만들기
router.post("/rooms", requireLogin, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const [users] = await connection.query(
            "SELECT nickname FROM users WHERE user_id = ?",
            [req.session.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: "로그인이 필요합니다." });
        }

        const requestedName =
            typeof req.body?.room_name === "string"
                ? req.body.room_name.trim()
                : "";

        const roomName = (requestedName || `${users[0].nickname}의 방`).slice(0, 100);

        // 중복되지 않는 코드가 나올 때까지 생성
        let inviteCode = "";
        for (let attempt = 0; attempt < 10; attempt++) {
            const candidate = generateInviteCode();
            const [exists] = await connection.query(
                "SELECT room_id FROM rooms WHERE invite_code = ?",
                [candidate]
            );

            if (exists.length === 0) {
                inviteCode = candidate;
                break;
            }
        }

        if (!inviteCode) {
            return res.status(500).json({ message: "방 코드를 만들지 못했습니다. 다시 시도해 주세요." });
        }

        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO rooms (owner_user_id, room_name, description, invite_code)
            VALUES (?, ?, '', ?)`,
            [req.session.userId, roomName, inviteCode]
        );

        await connection.query(
            `INSERT INTO room_members (room_id, user_id, role)
            VALUES (?, ?, 'owner')`,
            [result.insertId, req.session.userId]
        );

        await connection.commit();

        res.status(201).json({
            message: "방이 만들어졌습니다.",
            room: {
                room_id: result.insertId,
                room_name: roomName,
                invite_code: inviteCode
            }
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error("방 생성 실패:", error.message);
        res.status(500).json({ message: "방을 만들지 못했습니다." });
    } finally {
        connection.release();
    }
});

// 초대 코드로 방 참여하기 (링크로 들어와도 같은 API 사용)
router.post("/rooms/join", requireLogin, async (req, res) => {
    const inviteCode =
        typeof req.body?.invite_code === "string"
            ? req.body.invite_code.trim().toUpperCase()
            : "";

    if (!inviteCode) {
        return res.status(400).json({ message: "초대 코드를 입력해 주세요." });
    }

    try {
        const [rooms] = await pool.query(
            "SELECT room_id, room_name FROM rooms WHERE invite_code = ?",
            [inviteCode]
        );

        if (rooms.length === 0) {
            return res.status(404).json({ message: "초대 코드를 찾을 수 없습니다." });
        }

        const room = rooms[0];

        if (!(await isRoomMember(room.room_id, req.session.userId))) {
            await pool.query(
                `INSERT INTO room_members (room_id, user_id, role)
                VALUES (?, ?, 'member')`,
                [room.room_id, req.session.userId]
            );
        }

        res.json({ message: "방에 참여했습니다.", room });
    } catch (error) {
        console.error("방 참여 실패:", error.message);
        res.status(500).json({ message: "방에 참여하지 못했습니다." });
    }
});

// 방 정보 + 멤버별 색상 + 멤버별 되는 날짜
router.get("/rooms/:roomId", requireLogin, async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);

    if (!roomId) {
        return res.status(400).json({ message: "올바르지 않은 방 번호입니다." });
    }

    try {
        const userId = req.session.userId;

        if (!(await isRoomMember(roomId, userId))) {
            return res.status(403).json({ message: "이 방에 접근할 권한이 없습니다." });
        }

        const [rooms] = await pool.query(
            "SELECT room_id, room_name, invite_code FROM rooms WHERE room_id = ?",
            [roomId]
        );

        if (rooms.length === 0) {
            return res.status(404).json({ message: "방을 찾을 수 없습니다." });
        }

        const [members] = await pool.query(
            `SELECT rm.user_id, rm.role, u.nickname
            FROM room_members rm
            JOIN users u ON u.user_id = rm.user_id
            WHERE rm.room_id = ?
            ORDER BY (rm.role = 'owner') DESC, rm.user_id ASC`,
            [roomId]
        );

        const [availabilities] = await pool.query(
            `SELECT user_id, DATE_FORMAT(available_date, '%Y-%m-%d') AS date
            FROM room_availabilities
            WHERE room_id = ?
            ORDER BY available_date ASC`,
            [roomId]
        );

        const datesByUser = new Map();
        availabilities.forEach((item) => {
            if (!datesByUser.has(item.user_id)) {
                datesByUser.set(item.user_id, []);
            }
            datesByUser.get(item.user_id).push(item.date);
        });

        res.json({
            room: rooms[0],
            members: members.map((member, index) => ({
                user_id: member.user_id,
                nickname: member.nickname,
                role: member.role,
                color: MEMBER_COLORS[index % MEMBER_COLORS.length],
                is_me: member.user_id === userId,
                dates: datesByUser.get(member.user_id) || []
            }))
        });
    } catch (error) {
        console.error("방 조회 실패:", error.message);
        res.status(500).json({ message: "방 정보를 불러오지 못했습니다." });
    }
});

// 내가 되는 날짜 저장 (기존 선택을 통째로 덮어씀)
router.put("/rooms/:roomId/dates", requireLogin, async (req, res) => {
    const roomId = parseRoomId(req.params.roomId);

    if (!roomId) {
        return res.status(400).json({ message: "올바르지 않은 방 번호입니다." });
    }

    const rawDates = req.body?.dates;

    if (!Array.isArray(rawDates) || rawDates.length > 500) {
        return res.status(400).json({ message: "날짜 목록이 올바르지 않습니다." });
    }

    if (!rawDates.every(isValidDateString)) {
        return res.status(400).json({ message: "날짜 형식은 YYYY-MM-DD 이어야 합니다." });
    }

    const dates = [...new Set(rawDates)];
    const userId = req.session.userId;
    const connection = await pool.getConnection();

    try {
        if (!(await isRoomMember(roomId, userId))) {
            return res.status(403).json({ message: "이 방에 접근할 권한이 없습니다." });
        }

        await connection.beginTransaction();

        await connection.query(
            "DELETE FROM room_availabilities WHERE room_id = ? AND user_id = ?",
            [roomId, userId]
        );

        if (dates.length > 0) {
            await connection.query(
                "INSERT INTO room_availabilities (room_id, user_id, available_date) VALUES ?",
                [dates.map((date) => [roomId, userId, date])]
            );
        }

        await connection.commit();

        res.json({ message: "날짜가 저장되었습니다.", dates });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error("날짜 저장 실패:", error.message);
        res.status(500).json({ message: "날짜를 저장하지 못했습니다." });
    } finally {
        connection.release();
    }
});

router.isRoomMember = isRoomMember;

module.exports = router;
