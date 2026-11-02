    const screens = {
    home: document.getElementById("home-screen"),
    login: document.getElementById("login-screen"),
    register: document.getElementById("register-screen"),
    dashboard: document.getElementById("dashboard-screen"),
    appointments: document.getElementById("appointments-screen")
    };

    // 원하는 화면만 표시하기
    function showScreen(screenName) {
    Object.entries(screens).forEach(([name, screen]) => {
        screen.hidden = name !== screenName;
    });
    }

    // 화면 이동 버튼
    document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => {
        showScreen(button.dataset.go);
    });
    });

    // 서버 응답을 JSON으로 읽기
    async function readResponse(response) {
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "요청에 실패했습니다.");
    }

    return data;
    }

    // 회원가입
    document.getElementById("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    const user = {
        nickname: formData.get("nickname").trim(),
        email: formData.get("email").trim(),
        password: formData.get("password")
    };

    try {
        const response = await fetch("/api/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(user)
        });

        const data = await readResponse(response);

        alert(data.message);
        form.reset();
        showScreen("login");
    } catch (error) {
        alert(error.message);
    }
    });

    // 로그인
    document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    const user = {
        email: formData.get("email").trim(),
        password: formData.get("password")
    };

    try {
        const response = await fetch("/api/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(user)
        });

        const data = await readResponse(response);

        document.getElementById("welcome-message").textContent =
        `${data.user.nickname}님, 환영합니다!`;

        form.reset();
        showScreen("dashboard");
    } catch (error) {
        alert(error.message);
    }
    });

    // 로그아웃
    document.getElementById("logout-button").addEventListener("click", async () => {
    try {
        const response = await fetch("/api/logout", {
        method: "POST"
        });

        const data = await readResponse(response);

        alert(data.message);
        showScreen("home");
    } catch (error) {
        alert(error.message);
    }
    });

    // 처음에는 첫 화면 표시
    async function checkLogin() {
    try {
        const response = await fetch("/api/me");

        if (!response.ok) {
        showScreen("home");
        return;
        }

        const data = await response.json();

        document.getElementById("welcome-message").textContent =
        `${data.user.nickname}님, 환영합니다!`;

        showScreen("dashboard");
    } catch (error) {
        showScreen("home");
    }
    }

    // 공통 API 요청 함수
    async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
        ...(options.headers || {}),
        ...(options.body ? { "Content-Type": "application/json" } : {})
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "요청에 실패했습니다.");
    }

    return data;
    }

    // 내가 참여한 방 목록 불러오기
    async function loadRooms() {
    const list = document.getElementById("room-list");
    list.textContent = "방 목록을 불러오는 중...";

    try {
        const rooms = await apiRequest("/api/rooms");

        list.replaceChildren();

        if (rooms.length === 0) {
        list.textContent = "아직 참여한 방이 없습니다.";
        return;
        }

        rooms.forEach((room) => {
        const card = document.createElement("article");
        card.className = "room-card";

        const title = document.createElement("h4");
        title.textContent = room.room_name;

        const description = document.createElement("p");
        description.textContent = room.description || "설명이 없습니다.";

        const role = document.createElement("p");
        role.textContent = room.role === "owner" ? "방장" : "멤버";

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "약속 보기";
        button.addEventListener("click", () => {
            openRoom(room.room_id, room.room_name);
        });

        card.append(title, description, role, button);
        list.appendChild(card);
        });
    } catch (error) {
        list.textContent = error.message;
    }
    }

    // 방 만들기
    document.getElementById("create-room-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    try {
        const data = await apiRequest("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
            room_name: formData.get("room_name"),
            description: formData.get("description")
        })
        });

        alert(`${data.message}\n초대 코드: ${data.room.invite_code}`);
        event.currentTarget.reset();
        await loadRooms();
    } catch (error) {
        alert(error.message);
    }
    });

    // 초대 코드로 방 참여
    document.getElementById("join-room-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    try {
        const data = await apiRequest("/api/rooms/join", {
        method: "POST",
        body: JSON.stringify({
            invite_code: formData.get("invite_code")
        })
        });

        alert(data.message);
        event.currentTarget.reset();
        await loadRooms();
    } catch (error) {
        alert(error.message);
    }
    });

document.getElementById("refresh-rooms-button").addEventListener("click", loadRooms);

    checkLogin();

    let currentRoomId = null;

    // 방을 선택하면 해당 방의 약속 화면 열기
    async function openRoom(roomId, roomName) {
    currentRoomId = roomId;

    document.getElementById("appointment-room-title").textContent = roomName;
    showScreen("appointments");
    await loadAppointments();
    }

    // 약속 목록 불러오기
    async function loadAppointments() {
    const list = document.getElementById("appointment-list");
    list.textContent = "약속을 불러오는 중...";

    try {
        const appointments = await apiRequest(
        `/api/rooms/${currentRoomId}/appointments`
        );

        list.replaceChildren();

        if (appointments.length === 0) {
        list.textContent = "아직 등록된 약속이 없습니다.";
        return;
        }

        appointments.forEach((appointment) => {
        const card = document.createElement("article");
        card.className = "room-card";

        const title = document.createElement("h4");
        title.textContent = appointment.title;

        const date = document.createElement("p");
        const parsedDate = new Date(
            appointment.start_at.replace(" ", "T")
        );
        date.textContent = Number.isNaN(parsedDate.getTime())
            ? appointment.start_at
            : parsedDate.toLocaleString("ko-KR");

        const place = document.createElement("p");
        place.textContent = `장소: ${appointment.place}`;

        const description = document.createElement("p");
        description.textContent = appointment.description || "추가 설명 없음";

        card.append(title, date, place, description);
        list.appendChild(card);
        });
    } catch (error) {
        list.textContent = error.message;
    }
    }

    // 약속 등록
    document.getElementById("appointment-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentRoomId) {
        alert("먼저 친구 방을 선택해 주세요.");
        return;
    }

    const formData = new FormData(event.currentTarget);
    const startAt = String(formData.get("start_at")).replace("T", " ");

    try {
        const data = await apiRequest(
        `/api/rooms/${currentRoomId}/appointments`,
        {
            method: "POST",
            body: JSON.stringify({
            title: formData.get("title"),
            start_at: startAt,
            place: formData.get("place"),
            description: formData.get("description")
            })
        }
        );

        alert(data.message);
        event.currentTarget.reset();
        await loadAppointments();
    } catch (error) {
        alert(error.message);
    }
    });

    // 친구 방 목록으로 돌아가기
    document.getElementById("back-to-rooms").addEventListener("click", () => {
    showScreen("dashboard");
    loadRooms();
    });