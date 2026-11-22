const express = require("express");
const pool = require("../db");
const requireLogin = require("../middleware/auth");
const { isRoomMember } = require("./rooms");

const router = express.Router();

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function isValidDate(value) {
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

function isValidTime(value) {
    if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
        return false;
    }

    const [hour, minute] = value.split(":").map(Number);
    return hour < 24 && minute < 60;
}

// 요청 내용을 검사해서 { values } 또는 { error } 로 돌려줌
function readAppointment(body = {}) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const place = typeof body.place === "string" ? body.place.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const time = typeof body.time === "string" ? body.time.trim() : "";

    // 예전 방식(start_at: "YYYY-MM-DD HH:MM")도 받아 줌
    let date = typeof body.date === "string" ? body.date.trim() : "";
    if (!date && typeof body.start_at === "string") {
        date = body.start_at.trim().slice(0, 10);
    }

    if (!title || title.length > 200) {
        return { error: "뭐 하고 놀지 입력해 주세요. (200자 이내)" };
    }
    if (!isValidDate(date)) {
        return { error: "올바른 날짜를 선택해 주세요." };
    }
    if (time && !isValidTime(time)) {
        return { error: "올바른 시간을 입력해 주세요." };
    }
    if (place.length > 255) {
        return { error: "장소는 255자 이내로 입력해 주세요." };
    }
    if (description.length > 2000) {
        return { error: "메모는 2000자 이내로 입력해 주세요." };
    }

    return {
        values: {
            title,
            place,
            description,
            startAt: `${date} ${time || "00:00"}:00`
        }
    };
}

async function requireMember(req, res) {
    const roomId = parseId(req.params.roomId);

    if (!roomId) {
        res.status(400).json({ message: "올바르지 않은 방 번호입니다." });
        return null;
    }

    if (!(await isRoomMember(roomId, req.session.userId))) {
        res.status(403).json({ message: "이 방에 접근할 권한이 없습니다." });
        return null;
    }

    return roomId;
}

// 약속 목록
router.get("/rooms/:roomId/appointments", requireLogin, async (req, res) => {
    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const [appointments] = await pool.query(
            `SELECT
                appointment_id,
                title,
                DATE_FORMAT(start_at, '%Y-%m-%d') AS date,
                DATE_FORMAT(start_at, '%H:%i') AS time,
                place,
                description,
                status,
                creator_user_id
            FROM appointments
            WHERE room_id = ?
            ORDER BY start_at ASC, appointment_id ASC`,
            [roomId]
        );

        res.json(appointments);
    } catch (error) {
        console.error("약속 조회 실패:", error.message);
        res.status(500).json({ message: "약속 목록을 불러오지 못했습니다." });
    }
});

// 약속 등록
router.post("/rooms/:roomId/appointments", requireLogin, async (req, res) => {
    const input = readAppointment(req.body);

    if (input.error) {
        return res.status(400).json({ message: input.error });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const { title, place, description, startAt } = input.values;

        const [result] = await pool.query(
            `INSERT INTO appointments
            (room_id, creator_user_id, title, start_at, place, description, status)
            VALUES (?, ?, ?, ?, ?, ?, 'planned')`,
            [roomId, req.session.userId, title, startAt, place, description]
        );

        res.status(201).json({
            message: "약속이 등록되었습니다.",
            appointment_id: result.insertId
        });
    } catch (error) {
        console.error("약속 등록 실패:", error.message);
        res.status(500).json({ message: "약속을 등록하지 못했습니다." });
    }
});

// 약속 수정
router.put("/rooms/:roomId/appointments/:appointmentId", requireLogin, async (req, res) => {
    const appointmentId = parseId(req.params.appointmentId);
    const input = readAppointment(req.body);

    if (!appointmentId) {
        return res.status(400).json({ message: "올바르지 않은 약속 번호입니다." });
    }
    if (input.error) {
        return res.status(400).json({ message: input.error });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const { title, place, description, startAt } = input.values;

        const [result] = await pool.query(
            `UPDATE appointments
            SET title = ?, start_at = ?, place = ?, description = ?
            WHERE appointment_id = ? AND room_id = ?`,
            [title, startAt, place, description, appointmentId, roomId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "약속을 찾을 수 없습니다." });
        }

        res.json({ message: "약속이 수정되었습니다." });
    } catch (error) {
        console.error("약속 수정 실패:", error.message);
        res.status(500).json({ message: "약속을 수정하지 못했습니다." });
    }
});

// 약속 삭제
router.delete("/rooms/:roomId/appointments/:appointmentId", requireLogin, async (req, res) => {
    const appointmentId = parseId(req.params.appointmentId);

    if (!appointmentId) {
        return res.status(400).json({ message: "올바르지 않은 약속 번호입니다." });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const [result] = await pool.query(
            "DELETE FROM appointments WHERE appointment_id = ? AND room_id = ?",
            [appointmentId, roomId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "약속을 찾을 수 없습니다." });
        }

        res.json({ message: "약속이 삭제되었습니다." });
    } catch (error) {
        console.error("약속 삭제 실패:", error.message);
        res.status(500).json({ message: "약속을 삭제하지 못했습니다." });
    }
});

module.exports = router;
