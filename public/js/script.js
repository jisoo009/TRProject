(() => {
    "use strict";

    const $ = (selector) => document.querySelector(selector);

    const SVG_NS = "http://www.w3.org/2000/svg";
    const MONTHS = [
        "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
        "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
    ];
    const INVITE_KEY = "sm_pending_invite";
    const SAVE_DELAY = 500;      // 날짜를 누르고 이 시간(ms) 뒤에 서버에 저장
    const POLL_INTERVAL = 5000;  // 친구들이 고른 날짜를 불러오는 주기(ms)

    const screens = {
        home: $("#home-screen"),
        login: $("#login-screen"),
        register: $("#register-screen"),
        main: $("#main-screen")
    };

    const state = {
        user: null,
        rooms: [],
        room: null,          // 지금 들어가 있는 방 { room_id, room_name, invite_code }
        members: [],         // 방 멤버 (색상, 닉네임, 날짜 포함)
        mine: new Set(),     // 내가 고른 날짜 ("YYYY-MM-DD")
        tab: "home",
        year: new Date().getFullYear(),
        month: new Date().getMonth(),
        saveTimer: null,
        dirty: false,
        pollTimer: null
    };

    /* ------------------------------------------------------------------
       공통 도구
    ------------------------------------------------------------------ */
    let toastTimer = null;

    function toast(message) {
        const el = $("#toast");
        el.textContent = message;
        el.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
    }

    async function api(url, options = {}) {
        const init = { method: options.method || "GET", headers: {} };

        if (options.body instanceof FormData) {
            init.body = options.body;
        } else if (options.body !== undefined) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, init);
        let data = {};

        try {
            data = await response.json();
        } catch (error) {
            // 본문이 없는 응답
        }

        if (!response.ok) {
            const error = new Error(data.message || "요청에 실패했습니다.");
            error.status = response.status;
            throw error;
        }

        return data;
    }

    function handleError(error) {
        if (error.status === 401 && state.user) {
            resetSession();
            showScreen("login");
            toast("로그인이 만료되었습니다. 다시 로그인해 주세요.");
            return;
        }

        toast(error.message || "문제가 발생했습니다.");
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            // http 환경 등에서는 clipboard API를 쓸 수 없으므로 대체 방법 사용
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("readonly", "");
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();

            let ok = false;
            try {
                ok = document.execCommand("copy");
            } catch (copyError) {
                ok = false;
            }

            area.remove();
            return ok;
        }
    }

    function inviteLink(code) {
        return `${window.location.origin}/?code=${code}`;
    }

    function pad(number) {
        return String(number).padStart(2, "0");
    }

    function dateString(year, monthIndex, day) {
        return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    }

    /* ------------------------------------------------------------------
       화면 전환
    ------------------------------------------------------------------ */
    function showScreen(name) {
        Object.entries(screens).forEach(([key, el]) => {
            el.hidden = key !== name;
        });
        window.scrollTo(0, 0);
    }

    document.querySelectorAll("[data-go]").forEach((button) => {
        button.addEventListener("click", () => showScreen(button.dataset.go));
    });

    function resetSession() {
        clearTimeout(state.saveTimer);
        clearInterval(state.pollTimer);
        state.user = null;
        state.rooms = [];
        state.room = null;
        state.members = [];
        state.mine = new Set();
        state.saveTimer = null;
        state.dirty = false;
        state.pollTimer = null;
        $("#menu-panel").hidden = true;
    }

    /* ------------------------------------------------------------------
       회원가입 / 로그인 / 로그아웃
    ------------------------------------------------------------------ */
    $("#register-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);

        try {
            const data = await api("/api/signup", {
                method: "POST",
                body: {
                    nickname: String(formData.get("nickname")).trim(),
                    email: String(formData.get("email")).trim(),
                    password: String(formData.get("password"))
                }
            });

            $("#login-email").value = String(formData.get("email")).trim();
            form.reset();
            showScreen("login");
            toast(data.message);
            $("#login-password").focus();
        } catch (error) {
            toast(error.message);
        }
    });

    $("#login-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);

        try {
            const data = await api("/api/login", {
                method: "POST",
                body: {
                    email: String(formData.get("email")).trim(),
                    password: String(formData.get("password"))
                }
            });

            form.reset();
            await enterApp(data.user);
        } catch (error) {
            toast(error.message);
        }
    });

    $("#menu-logout").addEventListener("click", async () => {
        try {
            await api("/api/logout", { method: "POST" });
        } catch (error) {
            // 이미 세션이 없어도 화면은 처음으로 돌려보냄
        }

        resetSession();
        showScreen("home");
        toast("로그아웃되었습니다.");
    });

    $("#menu-button").addEventListener("click", () => {
        const panel = $("#menu-panel");
        panel.hidden = !panel.hidden;
        $("#menu-button").setAttribute("aria-expanded", String(!panel.hidden));
    });

    document.addEventListener("click", (event) => {
        const panel = $("#menu-panel");
        if (!panel.hidden && !panel.contains(event.target) && !$("#menu-button").contains(event.target)) {
            panel.hidden = true;
            $("#menu-button").setAttribute("aria-expanded", "false");
        }
    });

    /* ------------------------------------------------------------------
       로그인 이후 진입
    ------------------------------------------------------------------ */
    async function enterApp(user) {
        state.user = user;
        $("#menu-user").textContent = `${user.nickname}님`;
        showScreen("main");
        setTab("home");

        clearInterval(state.pollTimer);
        state.pollTimer = setInterval(pollRoom, POLL_INTERVAL);

        await loadRooms();

        // 초대 링크(?code=...)로 들어온 경우 로그인 직후 바로 참여
        const pendingCode = sessionStorage.getItem(INVITE_KEY);
        if (pendingCode) {
            sessionStorage.removeItem(INVITE_KEY);
            await joinByCode(pendingCode);
        }
    }

    /* ------------------------------------------------------------------
       탭 (Home / Room / Calender / Picture)
    ------------------------------------------------------------------ */
    function setTab(name) {
        state.tab = name;

        document.querySelectorAll(".tab").forEach((button) => {
            button.classList.toggle("active", button.dataset.tab === name);
        });

        ["home", "room", "calendar", "picture"].forEach((key) => {
            $(`#tab-${key}`).hidden = key !== name;
        });

        $("#menu-panel").hidden = true;

        if (name === "room") renderShare();
        if (name === "calendar") renderCalendarTab();
        if (name === "picture") renderPictureTab();
    }

    document.querySelectorAll(".tab").forEach((button) => {
        button.addEventListener("click", () => setTab(button.dataset.tab));
    });

    /* ------------------------------------------------------------------
       Home: 방 목록, 방 만들기, 코드로 참여
    ------------------------------------------------------------------ */
    function createHouseIcon() {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("aria-hidden", "true");

        const parts = [
            ["rect", { x: 67, y: 10, width: 12, height: 24, rx: 3, fill: "#8ccbff" }],
            ["path", {
                d: "M50 22 L21 49 V86 Q21 92 27 92 H73 Q79 92 79 86 V49 Z",
                fill: "#8ccbff"
            }],
            ["path", {
                d: "M9 47 L50 7 L91 47",
                fill: "none",
                stroke: "#8ccbff",
                "stroke-width": 7,
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
            }]
        ];

        parts.forEach(([tag, attrs]) => {
            const node = document.createElementNS(SVG_NS, tag);
            Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
            svg.appendChild(node);
        });

        return svg;
    }

    function renderHouses() {
        const row = $("#house-row");
        const plusButton = $("#create-room-button");

        row.querySelectorAll(".house").forEach((node) => node.remove());

        state.rooms.forEach((room) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "house";
            button.title = `${room.room_name} (${room.invite_code})`;
            if (state.room && state.room.room_id === room.room_id) {
                button.classList.add("current");
            }

            const name = document.createElement("span");
            name.className = "house-name";
            name.textContent = room.room_name;

            button.append(createHouseIcon(), name);
            button.addEventListener("click", () => openRoom(room.room_id, "calendar"));
            row.insertBefore(button, plusButton);
        });
    }

    async function loadRooms() {
        try {
            state.rooms = await api("/api/rooms");
            renderHouses();
        } catch (error) {
            handleError(error);
        }
    }

    // + 버튼: 방을 만들고 바로 그 방(Room 탭, 코드/링크 창)으로 이동
    $("#create-room-button").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;

        try {
            const data = await api("/api/rooms", { method: "POST", body: {} });
            await loadRooms();
            await openRoom(data.room.room_id, "room");
        } catch (error) {
            handleError(error);
        } finally {
            button.disabled = false;
        }
    });

    async function joinByCode(rawCode) {
        const code = String(rawCode || "").trim().toUpperCase();

        if (!code) {
            toast("초대 코드를 입력해 주세요.");
            return;
        }

        try {
            const data = await api("/api/rooms/join", {
                method: "POST",
                body: { invite_code: code }
            });

            await loadRooms();
            await openRoom(data.room.room_id, "calendar");
            toast("방에 참여했습니다.");
        } catch (error) {
            handleError(error);
        }
    }

    $("#join-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = $("#join-code");
        await joinByCode(input.value);
        input.value = "";
    });

    /* ------------------------------------------------------------------
       방 열기 / 서버에서 방 정보 불러오기
    ------------------------------------------------------------------ */
    async function openRoom(roomId, tab) {
        // 이전 방에서 아직 저장하지 못한 날짜가 있으면 먼저 저장
        if (state.saveTimer) {
            clearTimeout(state.saveTimer);
            await flushSave();
        }

        const known = state.rooms.find((room) => room.room_id === roomId);
        state.room = known ? { ...known } : { room_id: roomId, room_name: "", invite_code: "" };
        state.members = [];
        state.mine = new Set();
        state.dirty = false;

        const ok = await fetchRoom();
        if (!ok) return;

        renderHouses();
        setTab(tab);
    }

    async function fetchRoom() {
        if (!state.room) return false;

        const roomId = state.room.room_id;

        try {
            const data = await api(`/api/rooms/${roomId}`);

            // 응답을 기다리는 동안 다른 방으로 바뀌었다면 무시
            if (!state.room || state.room.room_id !== roomId) return false;

            state.room = data.room;
            state.members = data.members.map((member) => ({
                ...member,
                dateSet: new Set(member.dates)
            }));

            // 내가 막 누른 날짜가 저장되기 전에는 서버 값으로 덮어쓰지 않음
            if (!state.dirty) {
                const me = state.members.find((member) => member.is_me);
                state.mine = new Set(me ? me.dates : []);
            }

            if (state.tab === "calendar") {
                renderCalendar();
                renderLegend();
            }
            return true;
        } catch (error) {
            if (error.status === 403 || error.status === 404) {
                state.room = null;
                await loadRooms();
                setTab("home");
            }
            handleError(error);
            return false;
        }
    }

    async function pollRoom() {
        if (document.hidden || !state.room || state.tab !== "calendar") return;
        await fetchRoom();
    }

    /* ------------------------------------------------------------------
       Room 탭: 랜덤 코드 + 초대 링크 창
    ------------------------------------------------------------------ */
    function renderShare() {
        const hasRoom = Boolean(state.room);

        $("#room-empty").hidden = hasRoom;
        $("#share-modal").hidden = !hasRoom;

        if (!hasRoom) return;

        $("#share-code").textContent = state.room.invite_code;
        $("#share-link").textContent = inviteLink(state.room.invite_code);
    }

    $("#modal-close").addEventListener("click", () => setTab("calendar"));

    $("#copy-code").addEventListener("click", async () => {
        if (!state.room) return;
        const ok = await copyToClipboard(state.room.invite_code);
        toast(ok ? "코드가 복사되었습니다." : "복사하지 못했어요. 직접 선택해서 복사해 주세요.");
    });

    $("#copy-link").addEventListener("click", async () => {
        if (!state.room) return;
        const ok = await copyToClipboard(inviteLink(state.room.invite_code));
        toast(ok ? "초대 링크가 복사되었습니다." : "복사하지 못했어요. 직접 선택해서 복사해 주세요.");
    });

    /* ------------------------------------------------------------------
       Calender 탭: 되는 날짜 고르기 (멤버별 색 밑줄)
    ------------------------------------------------------------------ */
    function renderCalendarTab() {
        const hasRoom = Boolean(state.room);

        $("#calendar-empty").hidden = hasRoom;
        $("#calendar-area").hidden = !hasRoom;

        if (!hasRoom) return;

        renderCalendar();
        renderLegend();
    }

    function ownersOf(dateStr) {
        return state.members.filter((member) =>
            member.is_me ? state.mine.has(dateStr) : member.dateSet.has(dateStr)
        );
    }

    function renderCalendar() {
        const { year, month } = state;

        $("#cal-month").textContent = MONTHS[month];
        $("#cal-year").textContent = String(year);

        const grid = $("#cal-days");
        grid.replaceChildren();

        // 월요일 시작: 일(0)→6, 월(1)→0 ...
        const offset = (new Date(year, month, 1).getDay() + 6) % 7;
        const lastDate = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < offset; i++) {
            const empty = document.createElement("span");
            empty.className = "day empty";
            grid.appendChild(empty);
        }

        for (let day = 1; day <= lastDate; day++) {
            const dateStr = dateString(year, month, day);
            const owners = ownersOf(dateStr);

            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "day";
            cell.dataset.date = dateStr;
            cell.setAttribute("aria-label", `${month + 1}월 ${day}일`);
            cell.setAttribute("aria-pressed", String(state.mine.has(dateStr)));

            if (state.members.length > 1 && owners.length === state.members.length) {
                cell.classList.add("all");
            }

            const number = document.createElement("span");
            number.textContent = String(day);
            cell.appendChild(number);

            if (owners.length > 0) {
                const bars = document.createElement("span");
                bars.className = "bars";

                owners.forEach((member) => {
                    const bar = document.createElement("i");
                    bar.className = "bar";
                    bar.style.backgroundColor = member.color;
                    bar.title = member.nickname;
                    bars.appendChild(bar);
                });

                cell.appendChild(bars);
            }

            grid.appendChild(cell);
        }
    }

    function renderLegend() {
        const legend = $("#cal-legend");
        legend.replaceChildren();

        state.members.forEach((member) => {
            const item = document.createElement("li");
            const bar = document.createElement("i");
            bar.style.backgroundColor = member.color;

            item.append(bar, document.createTextNode(member.is_me ? `${member.nickname} (나)` : member.nickname));
            legend.appendChild(item);
        });
    }

    $("#cal-days").addEventListener("click", (event) => {
        const cell = event.target.closest(".day[data-date]");
        if (!cell || !state.room) return;

        const dateStr = cell.dataset.date;

        if (state.mine.has(dateStr)) {
            state.mine.delete(dateStr);
        } else {
            state.mine.add(dateStr);
        }

        renderCalendar();
        scheduleSave();
    });

    function changeMonth(delta) {
        state.month += delta;

        if (state.month < 0) {
            state.month = 11;
            state.year -= 1;
        } else if (state.month > 11) {
            state.month = 0;
            state.year += 1;
        }

        renderCalendar();
    }

    $("#cal-prev").addEventListener("click", () => changeMonth(-1));
    $("#cal-next").addEventListener("click", () => changeMonth(1));

    function scheduleSave() {
        state.dirty = true;
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(flushSave, SAVE_DELAY);
    }

    async function flushSave() {
        state.saveTimer = null;
        if (!state.room) return;

        const dates = [...state.mine].sort();

        try {
            await api(`/api/rooms/${state.room.room_id}/dates`, {
                method: "PUT",
                body: { dates }
            });
        } catch (error) {
            handleError(error);
        } finally {
            // 저장하는 사이에 또 눌렀다면 아직 저장할 게 남은 것
            if (!state.saveTimer) state.dirty = false;
        }
    }

    // 창을 닫거나 이동할 때 아직 저장 전인 날짜가 있으면 마저 저장
    window.addEventListener("pagehide", () => {
        if (state.saveTimer && state.room) {
            fetch(`/api/rooms/${state.room.room_id}/dates`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dates: [...state.mine].sort() }),
                keepalive: true
            });
        }
    });

    /* ------------------------------------------------------------------
       Picture 탭: 방 사진
    ------------------------------------------------------------------ */
    function renderPictureTab() {
        const hasRoom = Boolean(state.room);

        $("#picture-empty").hidden = hasRoom;
        $("#picture-area").hidden = !hasRoom;

        if (hasRoom) loadPhotos();
    }

    async function loadPhotos() {
        if (!state.room) return;

        const roomId = state.room.room_id;

        try {
            const photos = await api(`/api/rooms/${roomId}/photos`);
            if (!state.room || state.room.room_id !== roomId) return;

            const grid = $("#photo-grid");
            grid.replaceChildren();
            $("#photo-empty").hidden = photos.length > 0;

            photos.forEach((photo) => {
                const img = document.createElement("img");
                img.src = photo.file_path;
                img.alt = photo.caption || "방 사진";
                img.loading = "lazy";
                grid.appendChild(img);
            });
        } catch (error) {
            handleError(error);
        }
    }

    $("#photo-add").addEventListener("click", () => $("#photo-input").click());

    $("#photo-input").addEventListener("change", async (event) => {
        const input = event.currentTarget;
        const file = input.files[0];
        input.value = "";

        if (!file || !state.room) return;

        if (file.size > 5 * 1024 * 1024) {
            toast("사진은 5MB 이하만 올릴 수 있어요.");
            return;
        }

        const formData = new FormData();
        formData.append("photo", file);

        try {
            await api(`/api/rooms/${state.room.room_id}/photos`, {
                method: "POST",
                body: formData
            });
            toast("사진을 올렸어요.");
            await loadPhotos();
        } catch (error) {
            handleError(error);
        }
    });

    /* ------------------------------------------------------------------
       처음 열었을 때: 초대 링크 확인 + 로그인 여부 확인
    ------------------------------------------------------------------ */
    async function boot() {
        const params = new URLSearchParams(window.location.search);
        const code = (params.get("code") || "").trim().toUpperCase();

        if (code) {
            sessionStorage.setItem(INVITE_KEY, code);
            history.replaceState(null, "", window.location.pathname);
        }

        try {
            const data = await api("/api/me");
            await enterApp(data.user);
        } catch (error) {
            showScreen("home");

            if (sessionStorage.getItem(INVITE_KEY)) {
                toast("초대받은 방에 들어가려면 먼저 로그인해 주세요.");
            }
        }
    }

    boot();
})();
