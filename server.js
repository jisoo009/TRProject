    const crypto = require("crypto");
    const express = require("express");
    const pool = require("./db");
    const bcrypt = require("bcrypt");
    const session = require("express-session");

    const app = express();
    const PORT = 3000;

    // JSON 형식의 요청 데이터 읽기
    app.use(express.json());

    // 로그인 세션 설정
    app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 3
    }
    }));

    // public 폴더의 화면 제공
    app.use(express.static("public"));

    // 서버 확인
    app.get("/api/test", (req, res) => {
    res.json({
        message: "Time Remember 서버가 정상적으로 작동합니다!"
    });
    });

    // 회원 목록 조회
    app.get("/api/users", async (req, res) => {
    try {
        const [rows] = await pool.query(
        "SELECT user_id, email, nickname FROM users"
        );

        res.json(rows);
    } catch (error) {
        console.error("회원 조회 실패:", error.message);
        res.status(500).json({
        message: "회원 정보를 불러오지 못했습니다."
        });
    }
    });

    // 회원가입
    app.post("/api/register", async (req, res) => {
    try {
        const nickname =
        typeof req.body.nickname === "string"
            ? req.body.nickname.trim()
            : "";

        const email =
        typeof req.body.email === "string"
            ? req.body.email.trim().toLowerCase()
            : "";

        const password =
        typeof req.body.password === "string"
            ? req.body.password
            : "";

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

        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
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
        // 이메일 중복 등 DB 제약 조건 오류도 안전하게 처리
        if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            message: "이미 사용 중인 이메일입니다."
        });
        }

        console.error("회원가입 실패:", error.message);
        res.status(500).json({
        message: "회원가입 중 오류가 발생했습니다."
        });
    }
    });

    // 로그인
    app.post("/api/login", async (req, res) => {
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
        const passwordMatches = await bcrypt.compare(
        password,
        user.password_hash
        );

        if (!passwordMatches) {
        return res.status(401).json({
            message: "이메일 또는 비밀번호가 올바르지 않습니다."
        });
        }

        // 로그인 성공 후 세션 ID를 새로 발급
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
                message: "로그인 상태를 저장하지 못했습니다."
            });
            }

            res.json({
            message: "로그인에 성공했습니다.",
            user: {
                user_id: user.user_id,
                email: user.email,
                nickname: user.nickname
            }
            });
        });
        });
    } catch (error) {
        console.error("로그인 실패:", error.message);
        res.status(500).json({
        message: "로그인 중 오류가 발생했습니다."
        });
    }
    });

    // 현재 로그인한 회원 확인
    app.get("/api/me", async (req, res) => {
    try {
        if (!req.session.userId) {
        return res.status(401).json({
            message: "로그인이 필요합니다."
        });
        }

        const [users] = await pool.query(
        "SELECT user_id, email, nickname FROM users WHERE user_id = ?",
        [req.session.userId]
        );

        if (users.length === 0) {
        return res.status(401).json({
            message: "회원 정보를 찾을 수 없습니다."
        });
        }

        res.json({ user: users[0] });
    } catch (error) {
        console.error("회원 확인 실패:", error.message);
        res.status(500).json({
        message: "회원 정보를 확인하지 못했습니다."
        });
    }
    });

        // 방 참여 여부 확인 함수
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
    app.get("/api/rooms", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "로그인이 필요합니다." });
    }

    try {
        const [rooms] = await pool.query(
        `SELECT r.room_id, r.room_name, r.description,
                rm.role, r.created_at
        FROM rooms r
        JOIN room_members rm ON r.room_id = rm.room_id
        WHERE rm.user_id = ?
        ORDER BY r.created_at DESC`,
        [req.session.userId]
        );

        res.json(rooms);
    } catch (error) {
        console.error("방 목록 조회 실패:", error.message);
        res.status(500).json({ message: "방 목록을 불러오지 못했습니다." });
    }
    });

    // 방 만들기
    app.post("/api/rooms", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "로그인이 필요합니다." });
    }

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

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 초대 코드는 추측하기 어렵도록 무작위로 생성
        const inviteCode = crypto.randomBytes(6).toString("hex").toUpperCase();

        const [result] = await connection.query(
        `INSERT INTO rooms
        (owner_user_id, room_name, description, invite_code)
        VALUES (?, ?, ?, ?)`,
        [req.session.userId, roomName, description, inviteCode]
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
            description,
            invite_code: inviteCode
        }
        });
    } catch (error) {
        await connection.rollback();
        console.error("방 생성 실패:", error.message);
        res.status(500).json({ message: "방을 만들지 못했습니다." });
    } finally {
        connection.release();
    }
    });

    // 초대 코드로 방 참여하기
    app.post("/api/rooms/join", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "로그인이 필요합니다." });
    }

    const inviteCode =
        typeof req.body.invite_code === "string"
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

        await pool.query(
        `INSERT IGNORE INTO room_members (room_id, user_id, role)
        VALUES (?, ?, 'member')`,
        [room.room_id, req.session.userId]
        );

        res.json({
        message: "방에 참여했습니다.",
        room
        });
    } catch (error) {
        console.error("방 참여 실패:", error.message);
        res.status(500).json({ message: "방에 참여하지 못했습니다." });
    }
    });

    // 로그아웃
    app.post("/api/logout", (req, res) => {
    if (!req.session) {
        return res.json({ message: "로그아웃되었습니다." });
    }

    req.session.destroy((error) => {
        if (error) {
        console.error("로그아웃 실패:", error.message);
        return res.status(500).json({
            message: "로그아웃 중 오류가 발생했습니다."
        });
        }

        res.clearCookie("connect.sid");
        res.json({ message: "로그아웃되었습니다." });
    });
    });
    
    // 특정 방의 약속 목록 조회
    app.get("/api/rooms/:roomId/appointments", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "로그인이 필요합니다." });
    }

    const roomId = Number(req.params.roomId);

    if (!Number.isInteger(roomId) || roomId < 1) {
        return res.status(400).json({ message: "올바르지 않은 방 번호입니다." });
    }

    try {
        const member = await isRoomMember(roomId, req.session.userId);

        if (!member) {
        return res.status(403).json({ message: "이 방에 접근할 권한이 없습니다." });
        }

        const [appointments] = await pool.query(
        `SELECT appointment_id, title, start_at, place,
                description, status, creator_user_id
        FROM appointments
        WHERE room_id = ?
        ORDER BY start_at ASC`,
        [roomId]
        );

        res.json(appointments);
    } catch (error) {
        console.error("약속 조회 실패:", error.message);
        res.status(500).json({ message: "약속 목록을 불러오지 못했습니다." });
    }
    });

    // 약속 등록
    app.post("/api/rooms/:roomId/appointments", async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: "로그인이 필요합니다." });
    }

    const roomId = Number(req.params.roomId);
    const { title, start_at, place, description = "" } = req.body;

    if (!Number.isInteger(roomId) || roomId < 1) {
        return res.status(400).json({ message: "올바르지 않은 방 번호입니다." });
    }

    if (
        typeof title !== "string" ||
        !title.trim() ||
        title.trim().length > 200
    ) {
        return res.status(400).json({ message: "약속 제목을 입력해 주세요." });
    }

    if (typeof start_at !== "string" || !start_at.trim()) {
        return res.status(400).json({ message: "약속 날짜와 시간을 입력해 주세요." });
    }

    if (typeof place !== "string" || place.trim().length > 255) {
        return res.status(400).json({ message: "장소를 확인해 주세요." });
    }

    if (typeof description !== "string" || description.length > 2000) {
        return res.status(400).json({ message: "설명은 2000자 이내로 입력해 주세요." });
    }

    // 날짜 형식과 실제 날짜 유효성 확인
    const date = new Date(start_at);

    if (Number.isNaN(date.getTime())) {
        return res.status(400).json({ message: "올바른 날짜와 시간을 입력해 주세요." });
    }

    try {
        const member = await isRoomMember(roomId, req.session.userId);

        if (!member) {
        return res.status(403).json({ message: "이 방에 접근할 권한이 없습니다." });
        }

        const [result] = await pool.query(
        `INSERT INTO appointments
        (room_id, creator_user_id, title, start_at, place, description, status)
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
        res.status(500).json({ message: "약속을 등록하지 못했습니다." });
    }
    });

    // 서버 실행
    app.listen(PORT, () => {
    console.log(`서버 실행 주소: http://localhost:${PORT}`);
    });