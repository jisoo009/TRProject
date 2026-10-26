
    require("dotenv").config();

    const mysql = require("mysql2/promise");

    const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    waitForConnections: true,
    connectionLimit: 10
    });

    // 다른 파일에서도 데이터베이스를 사용할 수 있도록 내보내기
    module.exports = pool;
