
const express = require("express");
const fs = require("fs");
const pool = require("../db");
const requireLogin = require("../middleware/auth");
const { upload } = require("../config/upload");
const { isRoomMember } = require("./rooms");

const router = express.Router();

// 사진 업로드
router.post(
    "/rooms/:roomId/photos",
    requireLogin,
    upload.single("photo"),
    async (req, res) => {
        try {
        const roomId = Number(req.params.roomId);
        const userId = req.session.userId;

        const caption =
            typeof req.body.caption === "string"
            ? req.body.caption.trim()
            : "";

        if (!Number.isInteger(roomId) || roomId < 1) {
            if (req.file) {
            await fs.promises.unlink(req.file.path);
            }

            return res.status(400).json({
                message: "올바르지 않은 방 번호입니다."
        });
        }

        if (!req.file) {
            return res.status(400).json({
            message: "사진을 선택해 주세요."
            });
        }

        if (caption.length > 500) {
            await fs.promises.unlink(req.file.path);

            return res.status(400).json({
            message: "사진 설명은 500자 이하로 작성해 주세요."
            });
        }

        const member = await isRoomMember(roomId, userId);

        if (!member) {
            await fs.promises.unlink(req.file.path);

            return res.status(403).json({
            message: "이 방의 멤버만 사진을 올릴 수 있습니다."
            });
        }

        const filePath = `/uploads/${req.file.filename}`;

        const [result] = await pool.query(
            `INSERT INTO photos
            (room_id, uploader_user_id, file_path, caption)
            VALUES (?, ?, ?, ?)`,
            [roomId, userId, filePath, caption]
        );

        res.status(201).json({
            message: "사진이 업로드되었습니다.",
            photo_id: result.insertId,
            file_path: filePath
        });

    } catch (error) {
        console.error("사진 업로드 오류:", error);

        if (req.file && fs.existsSync(req.file.path)) {
            await fs.promises.unlink(req.file.path).catch(() => {});
        }

        res.status(500).json({
            message: "사진 업로드 중 오류가 발생했습니다."
        });
        }
    }
);

// 특정 방의 사진 목록 조회
router.get(
    "/rooms/:roomId/photos",
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
                message: "이 방의 사진을 볼 권한이 없습니다."
                });
            }

        const [photos] = await pool.query(
            `SELECT
            photo_id,
            uploader_user_id,
            file_path,
            caption,
            created_at
            FROM photos
            WHERE room_id = ?
            ORDER BY created_at DESC`,
        [roomId]
        );

        res.json(photos);

    } catch (error) {
        console.error("사진 조회 오류:", error);

        res.status(500).json({
            message: "사진을 불러오지 못했습니다."
        });
        }
    }
);

module.exports = router;
