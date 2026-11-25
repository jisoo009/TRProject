require("dotenv").config();

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4"
});

// database/save_memories.sql 에서 설계한 테이블과 칼럼 목록
// 서버 시작 때 필요한 테이블과 칼럼이 존재하는지 확인한다.
// 설계에 없는 추가 칼럼은 허용한다.
const DESIGNED_SCHEMA = {
    users: ["user_id", "email", "password_hash", "nickname", "created_at"],
    rooms: ["room_id", "owner_user_id", "room_name", "invite_code", "created_at"],
    room_members: ["room_id", "user_id", "joined_at"],
    room_availabilities: ["room_id", "user_id", "available_date"],
    appointments: [
        "appointment_id", "room_id", "creator_user_id", "title",
        "start_at", "place", "description", "created_at"
    ],
    photo_folders: [
        "folder_id", "room_id", "creator_user_id", "name",
        "folder_date", "note", "created_at"
    ],
    photos: ["photo_id", "folder_id", "uploader_user_id", "file_path", "caption", "created_at"],
    photo_likes: ["photo_id", "user_id"]
};

async function checkSchema() {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()`
    );

    const actual = new Map();
    rows.forEach((row) => {
        if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
        actual.get(row.table_name).add(row.column_name);
    });

    const problems = [];

    Object.entries(DESIGNED_SCHEMA).forEach(([table, columns]) => {
        const found = actual.get(table);

        if (!found) {
            problems.push(`테이블 없음: ${table}`);
            return;
        }

        columns.filter((column) => !found.has(column))
            .forEach((column) => problems.push(`칼럼 없음: ${table}.${column}`));

    });

    if (problems.length > 0) {
        const error = new Error(
            "DB에 필요한 테이블 또는 칼럼이 없습니다.\n  - " +
            problems.join("\n  - ")
        );
        error.code = "SCHEMA_MISMATCH";
        throw error;
    }
}

pool.checkSchema = checkSchema;

// 다른 파일에서도 데이터베이스를 사용할 수 있도록 내보내기
module.exports = pool;
