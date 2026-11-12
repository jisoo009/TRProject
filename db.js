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

// 서버 시작 시 필요한 테이블이 없으면 만들어 줍니다.
// (이미 있는 테이블은 건드리지 않습니다.)
async function createTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            nickname VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            room_id INT AUTO_INCREMENT PRIMARY KEY,
            owner_user_id INT NOT NULL,
            room_name VARCHAR(100) NOT NULL,
            description VARCHAR(500) NOT NULL DEFAULT '',
            invite_code VARCHAR(20) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS room_members (
            room_id INT NOT NULL,
            user_id INT NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'member',
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (room_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // 멤버별로 "되는 날짜"를 저장하는 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS room_availabilities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            room_id INT NOT NULL,
            user_id INT NOT NULL,
            available_date DATE NOT NULL,
            UNIQUE KEY unique_member_date (room_id, user_id, available_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS appointments (
            appointment_id INT AUTO_INCREMENT PRIMARY KEY,
            room_id INT NOT NULL,
            creator_user_id INT NOT NULL,
            title VARCHAR(200) NOT NULL,
            start_at DATETIME NOT NULL,
            place VARCHAR(255) NOT NULL DEFAULT '',
            description TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'planned',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS photos (
            photo_id INT AUTO_INCREMENT PRIMARY KEY,
            room_id INT NOT NULL,
            uploader_user_id INT NOT NULL,
            file_path VARCHAR(255) NOT NULL,
            caption VARCHAR(500) NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
}

// 예전 버전으로 이미 만들어진 테이블(room_code / host_id 등)을 지금 구조에 맞게 고칩니다.
async function columnsOf(table) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return new Set(rows.map((row) => row.name));
}

async function runMigration(label, sql) {
    try {
        await pool.query(sql);
        console.log(`DB 구조 수정: ${label}`);
    } catch (error) {
        console.error(`DB 구조 수정 실패 (${label}):`, error.message);
    }
}

async function migrateLegacySchema() {
    const rooms = await columnsOf("rooms");

    if (rooms.has("id") && !rooms.has("room_id")) {
        await runMigration("rooms.id -> room_id", "ALTER TABLE rooms CHANGE id room_id INT NOT NULL AUTO_INCREMENT");
    }
    if (rooms.has("room_code") && !rooms.has("invite_code")) {
        await runMigration("rooms.room_code -> invite_code", "ALTER TABLE rooms CHANGE room_code invite_code VARCHAR(20) NOT NULL");
    }
    if (rooms.has("host_id") && !rooms.has("owner_user_id")) {
        await runMigration("rooms.host_id -> owner_user_id", "ALTER TABLE rooms CHANGE host_id owner_user_id INT NOT NULL");
    }
    if (!rooms.has("room_name")) {
        await runMigration("rooms.room_name 추가", "ALTER TABLE rooms ADD COLUMN room_name VARCHAR(100) NOT NULL DEFAULT ''");
    }
    if (!rooms.has("description")) {
        await runMigration("rooms.description 추가", "ALTER TABLE rooms ADD COLUMN description VARCHAR(500) NOT NULL DEFAULT ''");
    }
    if (!rooms.has("created_at")) {
        await runMigration("rooms.created_at 추가", "ALTER TABLE rooms ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    }
    // 코드 칸이 너무 짧으면 넓혀 줌
    await pool.query("ALTER TABLE rooms MODIFY invite_code VARCHAR(20) NOT NULL").catch(() => {});

    const members = await columnsOf("room_members");

    if (!members.has("role")) {
        await runMigration("room_members.role 추가", "ALTER TABLE room_members ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'member'");
        await pool.query(
            `UPDATE room_members rm JOIN rooms r ON r.room_id = rm.room_id
            SET rm.role = 'owner' WHERE rm.user_id = r.owner_user_id`
        ).catch(() => {});
    }
    // 예전 구조의 nickname / color_hex는 값 없이 넣어도 되도록 기본값 지정
    if (members.has("nickname")) {
        await pool.query("ALTER TABLE room_members MODIFY nickname VARCHAR(50) NOT NULL DEFAULT ''").catch(() => {});
    }
    if (members.has("color_hex")) {
        await pool.query("ALTER TABLE room_members MODIFY color_hex VARCHAR(20) NOT NULL DEFAULT ''").catch(() => {});
    }
}

async function initTables() {
    await createTables();
    await migrateLegacySchema();
}

pool.initTables = initTables;

// 다른 파일에서도 데이터베이스를 사용할 수 있도록 내보내기
module.exports = pool;
