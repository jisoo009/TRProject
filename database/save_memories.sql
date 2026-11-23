-- =====================================================================
--  Save Memories  /  데이터베이스 샘플 (MySQL 8.x, MariaDB 10.x 호환)
--
--  사용법
--    mysql -u root -p < database/save_memories.sql
--  (또는 MySQL Workbench / DBeaver에서 이 파일을 열어 전체 실행)
--
--  샘플 계정 (비밀번호는 모두 password1234)
--    jisu@example.com / minsu@example.com / haeun@example.com
-- =====================================================================

-- 한글 샘플 데이터가 깨지지 않도록 접속 문자셋을 먼저 지정한다.
CREATE DATABASE IF NOT EXISTS save_memories_sample DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE save_memories_sample;

-- =====================================================================
--  테이블 설계 (제3정규형)
--
--  · 모든 칼럼은 원자값이다.                                      (1NF)
--  · 복합 키를 쓰는 테이블(room_members, room_availabilities, photo_likes)의
--    속성은 키 전체에 종속된다.                                     (2NF)
--  · 키가 아닌 속성끼리 종속 관계가 없다.                           (3NF)
--      - 방장은 rooms.owner_user_id 한 곳에만 저장한다.
--        (room_members에 role 칼럼을 두면 같은 사실이 두 번 저장되므로 제외)
--      - 닉네임은 users.nickname 한 곳에만 저장하고 JOIN으로 가져온다.
--      - 사진이 속한 방은 photos.room_id 대신
--        photos.folder_id -> photo_folders.room_id 로만 알아낸다.
--        (photo -> folder -> room 이행 종속 제거)
--      - 멤버별 색상은 저장하지 않고 참여 순서로 계산한다.
-- =====================================================================

-- 1. 회원
CREATE TABLE users (
    user_id INT NOT NULL AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB;

-- 2. 방 (방장 = owner_user_id)
CREATE TABLE rooms (
    room_id INT NOT NULL AUTO_INCREMENT,
    owner_user_id INT NOT NULL,
    room_name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id),
    UNIQUE KEY uq_rooms_invite_code (invite_code),
    CONSTRAINT fk_rooms_owner FOREIGN KEY (owner_user_id) REFERENCES users (user_id)
) ENGINE = InnoDB;

-- 3. 방 참여 멤버 (회원 N : 방 M 관계를 풀어낸 테이블)
CREATE TABLE room_members (
    room_id INT NOT NULL,
    user_id INT NOT NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id),
    CONSTRAINT fk_members_room FOREIGN KEY (room_id) REFERENCES rooms (room_id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE = InnoDB;

-- 4. 멤버별 "되는 날짜" (달력에서 고른 날짜)
--    (room_id, user_id)는 반드시 방 멤버여야 하므로 room_members를 참조한다.
--    멤버가 방을 나가면 그 사람의 날짜도 함께 삭제된다.
CREATE TABLE room_availabilities (
    room_id INT NOT NULL,
    user_id INT NOT NULL,
    available_date DATE NOT NULL,
    PRIMARY KEY (
        room_id,
        user_id,
        available_date
    ),
    CONSTRAINT fk_avail_member FOREIGN KEY (room_id, user_id) REFERENCES room_members (room_id, user_id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- 5. 약속 (날짜 + 뭐 하고 놀지)
CREATE TABLE appointments (
    appointment_id INT NOT NULL AUTO_INCREMENT,
    room_id INT NOT NULL,
    creator_user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    start_at DATETIME NOT NULL,
    place VARCHAR(255) NOT NULL DEFAULT '',
    description VARCHAR(2000) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (appointment_id),
    KEY idx_appointments_room_start (room_id, start_at),
    CONSTRAINT fk_appointments_room FOREIGN KEY (room_id) REFERENCES rooms (room_id) ON DELETE CASCADE,
    CONSTRAINT fk_appointments_creator FOREIGN KEY (creator_user_id) REFERENCES users (user_id)
) ENGINE = InnoDB;

-- 6. 사진 폴더 (날짜별로 분리)
CREATE TABLE photo_folders (
    folder_id INT NOT NULL AUTO_INCREMENT,
    room_id INT NOT NULL,
    creator_user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    folder_date DATE NULL,
    note VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (folder_id),
    KEY idx_folders_room (room_id),
    CONSTRAINT fk_folders_room FOREIGN KEY (room_id) REFERENCES rooms (room_id) ON DELETE CASCADE,
    CONSTRAINT fk_folders_creator FOREIGN KEY (creator_user_id) REFERENCES users (user_id)
) ENGINE = InnoDB;

-- 7. 사진 (반드시 폴더 안에 저장)
CREATE TABLE photos (
    photo_id INT NOT NULL AUTO_INCREMENT,
    folder_id INT NOT NULL,
    uploader_user_id INT NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    caption VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (photo_id),
    KEY idx_photos_folder (folder_id),
    CONSTRAINT fk_photos_folder FOREIGN KEY (folder_id) REFERENCES photo_folders (folder_id) ON DELETE CASCADE,
    CONSTRAINT fk_photos_uploader FOREIGN KEY (uploader_user_id) REFERENCES users (user_id)
) ENGINE = InnoDB;

-- 8. 사진 좋아요 (회원 N : 사진 M 관계)
CREATE TABLE photo_likes (
    photo_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (photo_id, user_id),
    CONSTRAINT fk_likes_photo FOREIGN KEY (photo_id) REFERENCES photos (photo_id) ON DELETE CASCADE,
    CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE = InnoDB;

-- =====================================================================
--  샘플 데이터
-- =====================================================================

INSERT INTO
    users (
        user_id,
        email,
        password_hash,
        nickname,
        created_at
    )
VALUES (
        1,
        'jisu@example.com',
        '$2b$10$LaR/AY5JIUbxqhIMSRiXL.X8.W5LHuCn6A7wAIyT1bRMx6HadJHwu',
        '지수',
        '2026-08-01 10:00:00'
    ),
    (
        2,
        'minsu@example.com',
        '$2b$10$LaR/AY5JIUbxqhIMSRiXL.X8.W5LHuCn6A7wAIyT1bRMx6HadJHwu',
        '민수',
        '2026-08-01 10:05:00'
    ),
    (
        3,
        'haeun@example.com',
        '$2b$10$LaR/AY5JIUbxqhIMSRiXL.X8.W5LHuCn6A7wAIyT1bRMx6HadJHwu',
        '하은',
        '2026-08-02 09:30:00'
    );

INSERT INTO
    rooms (
        room_id,
        owner_user_id,
        room_name,
        invite_code,
        created_at
    )
VALUES (
        1,
        1,
        '우리 셋의 방',
        'SAVE01',
        '2026-08-05 12:00:00'
    ),
    (
        2,
        2,
        '동아리 모임',
        'CLUB22',
        '2026-09-01 18:00:00'
    );

INSERT INTO
    room_members (room_id, user_id, joined_at)
VALUES (1, 1, '2026-08-05 12:00:00'),
    (1, 2, '2026-08-05 12:10:00'),
    (1, 3, '2026-08-05 12:20:00'),
    (2, 2, '2026-09-01 18:00:00'),
    (2, 1, '2026-09-01 18:30:00');

INSERT INTO
    room_availabilities (
        room_id,
        user_id,
        available_date
    )
VALUES (1, 1, '2026-11-28'),
    (1, 1, '2026-11-29'),
    (1, 1, '2026-12-05'),
    (1, 1, '2026-12-12'),
    (1, 2, '2026-11-29'),
    (1, 2, '2026-12-05'),
    (1, 2, '2026-12-19'),
    (1, 3, '2026-11-29'),
    (1, 3, '2026-12-05'),
    (1, 3, '2026-12-12'),
    (2, 2, '2026-12-06'),
    (2, 2, '2026-12-13'),
    (2, 1, '2026-12-13');

INSERT INTO
    appointments (
        appointment_id,
        room_id,
        creator_user_id,
        title,
        start_at,
        place,
        description,
        created_at
    )
VALUES (
        1,
        1,
        1,
        '홍대 놀러가기',
        '2026-08-19 00:00:00',
        '홍대입구역 9번 출구',
        '카페 갔다가 노래방!',
        '2026-08-10 20:00:00'
    ),
    (
        2,
        1,
        2,
        '한강 놀러가기',
        '2026-10-09 15:00:00',
        '여의도 한강공원',
        '돗자리, 치킨 준비하기',
        '2026-10-01 21:00:00'
    ),
    (
        3,
        1,
        3,
        '크리스마스 파티',
        '2026-12-05 18:00:00',
        '지수네 집',
        '케이크는 하은이가 사오기',
        '2026-11-20 19:00:00'
    ),
    (
        4,
        2,
        2,
        '송년 모임',
        '2026-12-13 19:00:00',
        '건대입구',
        '',
        '2026-11-22 10:00:00'
    );

INSERT INTO
    photo_folders (
        folder_id,
        room_id,
        creator_user_id,
        name,
        folder_date,
        note,
        created_at
    )
VALUES (
        1,
        1,
        1,
        '홍대 놀러간 날',
        '2026-08-19',
        '카페도 가고 노래방도 갔던 날',
        '2026-08-19 22:00:00'
    ),
    (
        2,
        1,
        2,
        '한강 피크닉',
        '2026-10-09',
        '바람이 너무 좋았다',
        '2026-10-09 20:00:00'
    ),
    (
        3,
        2,
        2,
        '동아리 첫 모임',
        '2026-09-01',
        '',
        '2026-09-01 21:00:00'
    );

INSERT INTO
    photos (
        photo_id,
        folder_id,
        uploader_user_id,
        file_path,
        caption,
        created_at
    )
VALUES (
        1,
        1,
        1,
        '/sample/sample-1.jpg',
        '카페 앞에서',
        '2026-08-19 22:10:00'
    ),
    (
        2,
        1,
        3,
        '/sample/sample-2.jpg',
        '노래방 가는 길',
        '2026-08-19 22:15:00'
    ),
    (
        3,
        2,
        2,
        '/sample/sample-3.jpg',
        '한강 돗자리',
        '2026-10-09 20:10:00'
    ),
    (
        4,
        2,
        1,
        '/sample/sample-4.jpg',
        '해 질 무렵',
        '2026-10-09 20:20:00'
    ),
    (
        5,
        3,
        2,
        '/sample/sample-5.jpg',
        '첫 모임 단체사진',
        '2026-09-01 21:10:00'
    );

INSERT INTO
    photo_likes (photo_id, user_id)
VALUES (1, 2),
    (1, 3),
    (2, 1),
    (3, 1),
    (3, 3),
    (4, 2);