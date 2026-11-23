const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const requireLogin = require("../middleware/auth");
const { upload, uploadDir } = require("../config/upload");
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

function removeFile(filePath) {
    if (!filePath) return;

    const target = path.join(uploadDir, path.basename(filePath));
    fs.promises.unlink(target).catch(() => {});
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

// 사진은 폴더에 속하고, 폴더가 방에 속한다. (photos 에는 room_id 를 따로 저장하지 않음)
async function findPhotoInRoom(photoId, roomId) {
    const [photos] = await pool.query(
        `SELECT p.photo_id, p.file_path
        FROM photos p
        JOIN photo_folders f ON f.folder_id = p.folder_id
        WHERE p.photo_id = ? AND f.room_id = ?`,
        [photoId, roomId]
    );

    return photos[0] || null;
}

async function folderInRoom(folderId, roomId) {
    const [folders] = await pool.query(
        "SELECT folder_id FROM photo_folders WHERE folder_id = ? AND room_id = ?",
        [folderId, roomId]
    );

    return folders.length > 0;
}

/* ---------------------------------------------------------------
   폴더
--------------------------------------------------------------- */

function readFolder(body = {}) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const rawDate = typeof body.folder_date === "string" ? body.folder_date.trim() : "";

    if (!name || name.length > 100) {
        return { error: "폴더 이름을 입력해 주세요. (100자 이내)" };
    }
    if (note.length > 500) {
        return { error: "설명은 500자 이내로 입력해 주세요." };
    }
    if (rawDate && !isValidDate(rawDate)) {
        return { error: "올바른 날짜를 선택해 주세요." };
    }

    return { values: { name, note, folderDate: rawDate || null } };
}

// 폴더 목록 (최근 날짜 순)
router.get("/rooms/:roomId/folders", requireLogin, async (req, res) => {
    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const [folders] = await pool.query(
            `SELECT
                f.folder_id,
                f.name,
                DATE_FORMAT(f.folder_date, '%Y-%m-%d') AS folder_date,
                f.note,
                f.creator_user_id,
                u.nickname AS creator_nickname,
                (SELECT COUNT(*) FROM photos p WHERE p.folder_id = f.folder_id) AS photo_count,
                (SELECT p.file_path FROM photos p
                    WHERE p.folder_id = f.folder_id
                    ORDER BY p.created_at DESC, p.photo_id DESC LIMIT 1) AS cover
            FROM photo_folders f
            JOIN users u ON u.user_id = f.creator_user_id
            WHERE f.room_id = ?
            ORDER BY (f.folder_date IS NULL) ASC, f.folder_date DESC, f.created_at DESC, f.folder_id DESC`,
            [roomId]
        );

        res.json(folders);
    } catch (error) {
        console.error("폴더 조회 실패:", error.message);
        res.status(500).json({ message: "폴더 목록을 불러오지 못했습니다." });
    }
});

router.post("/rooms/:roomId/folders", requireLogin, async (req, res) => {
    const input = readFolder(req.body);

    if (input.error) {
        return res.status(400).json({ message: input.error });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const { name, note, folderDate } = input.values;

        const [result] = await pool.query(
            `INSERT INTO photo_folders (room_id, creator_user_id, name, folder_date, note)
            VALUES (?, ?, ?, ?, ?)`,
            [roomId, req.session.userId, name, folderDate, note]
        );

        res.status(201).json({ message: "폴더가 만들어졌습니다.", folder_id: result.insertId });
    } catch (error) {
        console.error("폴더 생성 실패:", error.message);
        res.status(500).json({ message: "폴더를 만들지 못했습니다." });
    }
});

router.put("/rooms/:roomId/folders/:folderId", requireLogin, async (req, res) => {
    const folderId = parseId(req.params.folderId);
    const input = readFolder(req.body);

    if (!folderId) {
        return res.status(400).json({ message: "올바르지 않은 폴더 번호입니다." });
    }
    if (input.error) {
        return res.status(400).json({ message: input.error });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const { name, note, folderDate } = input.values;

        const [result] = await pool.query(
            `UPDATE photo_folders
            SET name = ?, folder_date = ?, note = ?
            WHERE folder_id = ? AND room_id = ?`,
            [name, folderDate, note, folderId, roomId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        }

        res.json({ message: "폴더가 수정되었습니다." });
    } catch (error) {
        console.error("폴더 수정 실패:", error.message);
        res.status(500).json({ message: "폴더를 수정하지 못했습니다." });
    }
});

// 폴더 삭제 (안의 사진과 좋아요는 FK ON DELETE CASCADE 로 함께 삭제)
router.delete("/rooms/:roomId/folders/:folderId", requireLogin, async (req, res) => {
    const folderId = parseId(req.params.folderId);

    if (!folderId) {
        return res.status(400).json({ message: "올바르지 않은 폴더 번호입니다." });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        if (!(await folderInRoom(folderId, roomId))) {
            return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        }

        const [photos] = await pool.query(
            "SELECT file_path FROM photos WHERE folder_id = ?",
            [folderId]
        );

        await pool.query(
            "DELETE FROM photo_folders WHERE folder_id = ? AND room_id = ?",
            [folderId, roomId]
        );

        photos.forEach((photo) => removeFile(photo.file_path));

        res.json({ message: "폴더를 삭제했습니다." });
    } catch (error) {
        console.error("폴더 삭제 실패:", error.message);
        res.status(500).json({ message: "폴더를 삭제하지 못했습니다." });
    }
});

/* ---------------------------------------------------------------
   사진
--------------------------------------------------------------- */

// 폴더 안 사진 목록 (?folder_id=번호)
router.get("/rooms/:roomId/photos", requireLogin, async (req, res) => {
    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const folderId = parseId(req.query.folder_id);

        if (!folderId) {
            return res.status(400).json({ message: "folder_id 가 필요합니다." });
        }

        if (!(await folderInRoom(folderId, roomId))) {
            return res.status(404).json({ message: "폴더를 찾을 수 없습니다." });
        }

        const [photos] = await pool.query(
            `SELECT
                p.photo_id,
                p.folder_id,
                p.uploader_user_id,
                u.nickname AS uploader_nickname,
                p.file_path,
                p.caption,
                p.created_at,
                (SELECT COUNT(*) FROM photo_likes l WHERE l.photo_id = p.photo_id) AS like_count,
                EXISTS(SELECT 1 FROM photo_likes l
                    WHERE l.photo_id = p.photo_id AND l.user_id = ?) AS liked
            FROM photos p
            JOIN users u ON u.user_id = p.uploader_user_id
            WHERE p.folder_id = ?
            ORDER BY p.created_at DESC, p.photo_id DESC`,
            [req.session.userId, folderId]
        );

        res.json(photos.map((photo) => ({ ...photo, liked: Boolean(photo.liked) })));
    } catch (error) {
        console.error("사진 조회 실패:", error.message);
        res.status(500).json({ message: "사진 목록을 불러오지 못했습니다." });
    }
});

// 사진 업로드 (folder_id 필수)
router.post("/rooms/:roomId/photos", requireLogin, (req, res) => {
    upload.single("photo")(req, res, async (uploadError) => {
        if (uploadError) {
            const message = uploadError.code === "LIMIT_FILE_SIZE"
                ? "사진은 5MB 이하만 올릴 수 있습니다."
                : uploadError.message || "사진을 업로드하지 못했습니다.";
            return res.status(400).json({ message });
        }

        const discard = () => removeFile(req.file && req.file.filename);

        try {
            const roomId = parseId(req.params.roomId);
            const userId = req.session.userId;

            if (!roomId) {
                discard();
                return res.status(400).json({ message: "올바르지 않은 방 번호입니다." });
            }

            if (!req.file) {
                return res.status(400).json({ message: "사진을 선택해 주세요." });
            }

            if (!(await isRoomMember(roomId, userId))) {
                discard();
                return res.status(403).json({ message: "이 방의 멤버만 사진을 올릴 수 있습니다." });
            }

            const caption = typeof req.body.caption === "string" ? req.body.caption.trim() : "";

            if (caption.length > 500) {
                discard();
                return res.status(400).json({ message: "사진 설명은 500자 이하로 작성해 주세요." });
            }

            const folderId = parseId(req.body.folder_id);

            if (!folderId || !(await folderInRoom(folderId, roomId))) {
                discard();
                return res.status(404).json({ message: "사진을 넣을 폴더를 찾을 수 없습니다." });
            }

            const filePath = `/uploads/${req.file.filename}`;

            const [result] = await pool.query(
                `INSERT INTO photos (folder_id, uploader_user_id, file_path, caption)
                VALUES (?, ?, ?, ?)`,
                [folderId, userId, filePath, caption]
            );

            res.status(201).json({
                message: "사진이 업로드되었습니다.",
                photo_id: result.insertId,
                file_path: filePath
            });
        } catch (error) {
            discard();
            console.error("사진 업로드 실패:", error.message);
            res.status(500).json({ message: "사진을 업로드하지 못했습니다." });
        }
    });
});

// 사진 설명 수정
router.put("/rooms/:roomId/photos/:photoId", requireLogin, async (req, res) => {
    const photoId = parseId(req.params.photoId);
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : null;

    if (!photoId) {
        return res.status(400).json({ message: "올바르지 않은 사진 번호입니다." });
    }
    if (caption === null || caption.length > 500) {
        return res.status(400).json({ message: "설명은 500자 이하로 입력해 주세요." });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        if (!(await findPhotoInRoom(photoId, roomId))) {
            return res.status(404).json({ message: "사진을 찾을 수 없습니다." });
        }

        await pool.query("UPDATE photos SET caption = ? WHERE photo_id = ?", [caption, photoId]);

        res.json({ message: "사진 설명이 수정되었습니다.", caption });
    } catch (error) {
        console.error("사진 수정 실패:", error.message);
        res.status(500).json({ message: "사진을 수정하지 못했습니다." });
    }
});

// 사진 삭제 (좋아요는 FK ON DELETE CASCADE 로 함께 삭제)
router.delete("/rooms/:roomId/photos/:photoId", requireLogin, async (req, res) => {
    const photoId = parseId(req.params.photoId);

    if (!photoId) {
        return res.status(400).json({ message: "올바르지 않은 사진 번호입니다." });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const photo = await findPhotoInRoom(photoId, roomId);

        if (!photo) {
            return res.status(404).json({ message: "사진을 찾을 수 없습니다." });
        }

        await pool.query("DELETE FROM photos WHERE photo_id = ?", [photoId]);
        removeFile(photo.file_path);

        res.json({ message: "사진을 삭제했습니다." });
    } catch (error) {
        console.error("사진 삭제 실패:", error.message);
        res.status(500).json({ message: "사진을 삭제하지 못했습니다." });
    }
});

// 좋아요 켜기/끄기
router.post("/rooms/:roomId/photos/:photoId/like", requireLogin, async (req, res) => {
    const photoId = parseId(req.params.photoId);

    if (!photoId) {
        return res.status(400).json({ message: "올바르지 않은 사진 번호입니다." });
    }

    try {
        const roomId = await requireMember(req, res);
        if (!roomId) return;

        const userId = req.session.userId;

        if (!(await findPhotoInRoom(photoId, roomId))) {
            return res.status(404).json({ message: "사진을 찾을 수 없습니다." });
        }

        const [existing] = await pool.query(
            "SELECT 1 FROM photo_likes WHERE photo_id = ? AND user_id = ?",
            [photoId, userId]
        );

        let liked;
        if (existing.length > 0) {
            await pool.query(
                "DELETE FROM photo_likes WHERE photo_id = ? AND user_id = ?",
                [photoId, userId]
            );
            liked = false;
        } else {
            await pool.query(
                "INSERT INTO photo_likes (photo_id, user_id) VALUES (?, ?)",
                [photoId, userId]
            );
            liked = true;
        }

        const [counts] = await pool.query(
            "SELECT COUNT(*) AS like_count FROM photo_likes WHERE photo_id = ?",
            [photoId]
        );

        res.json({ liked, like_count: counts[0].like_count });
    } catch (error) {
        console.error("좋아요 실패:", error.message);
        res.status(500).json({ message: "좋아요를 처리하지 못했습니다." });
    }
});

module.exports = router;
