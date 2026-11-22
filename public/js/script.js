(() => {
    "use strict";

    const $ = (selector) => document.querySelector(selector);

    const SVG_NS = "http://www.w3.org/2000/svg";
    const XLINK = "http://www.w3.org/1999/xlink";
    const MONTHS = [
        "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
        "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
    ];
    const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
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
        photos: [],
        appts: [],
        apptsExpanded: false,
        folders: [],
        folder: null,        // 지금 열어 둔 사진 폴더
        viewerIndex: -1,
        calView: "dates",
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

    function icon(name, extraClass = "") {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", `i ${extraClass}`.trim());
        svg.setAttribute("aria-hidden", "true");
        const use = document.createElementNS(SVG_NS, "use");
        use.setAttribute("href", `#i-${name}`);
        use.setAttributeNS(XLINK, "xlink:href", `#i-${name}`);
        svg.appendChild(use);
        return svg;
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

    function todayString() {
        const now = new Date();
        return dateString(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function firstLetter(text) {
        return [...String(text || "?")][0] || "?";
    }

    function makeAvatar(member, small = false) {
        const el = document.createElement("span");
        el.className = small ? "avatar sm" : "avatar";
        el.style.background = member.color;
        el.textContent = firstLetter(member.nickname);
        el.title = member.nickname;
        return el;
    }

    function setFormError(id, message) {
        const el = $(id);
        el.textContent = message || "";
        el.hidden = !message;
    }

    /* ------------------------------------------------------------------
       화면 전환
    ------------------------------------------------------------------ */
    function showScreen(name) {
        Object.entries(screens).forEach(([key, el]) => {
            el.hidden = key !== name;
        });
    }

    document.querySelectorAll("[data-go]").forEach((button) => {
        button.addEventListener("click", () => {
            setFormError("#login-error", "");
            setFormError("#register-error", "");
            showScreen(button.dataset.go);
        });
    });

    document.querySelectorAll(".pw-toggle").forEach((button) => {
        button.addEventListener("click", () => {
            const input = document.getElementById(button.dataset.target);
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            button.querySelector("use").setAttribute("href", show ? "#i-eye-off" : "#i-eye");
            button.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 보기");
        });
    });

    function resetSession() {
        clearTimeout(state.saveTimer);
        clearInterval(state.pollTimer);
        state.user = null;
        state.rooms = [];
        state.room = null;
        state.members = [];
        state.mine = new Set();
        state.photos = [];
        state.appts = [];
        state.folders = [];
        state.folder = null;
        state.viewerIndex = -1;
        state.saveTimer = null;
        state.dirty = false;
        state.pollTimer = null;
        $("#menu-panel").hidden = true;
        closeShareDialog();
        closeLightbox();
    }

    /* ------------------------------------------------------------------
       회원가입 / 로그인 / 로그아웃
    ------------------------------------------------------------------ */
    $("#register-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        setFormError("#register-error", "");

        const submit = form.querySelector("button[type=submit]");
        submit.disabled = true;

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
            setFormError("#register-error", error.message);
        } finally {
            submit.disabled = false;
        }
    });

    $("#login-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        setFormError("#login-error", "");

        const submit = form.querySelector("button[type=submit]");
        submit.disabled = true;

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
            setFormError("#login-error", error.message);
        } finally {
            submit.disabled = false;
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
        $("#avatar-initial").textContent = firstLetter(user.nickname);
        $("#hello-title").textContent = `안녕, ${user.nickname}!`;
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
       탭 (Home / Room / Calendar / Picture)
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
        $(".tab-panels").scrollTop = 0;

        updateAppbar();

        if (name === "room") renderRoomTab();
        if (name === "calendar") renderCalendarTab();
        if (name === "picture") renderPictureTab();
    }

    document.querySelectorAll(".tab").forEach((button) => {
        button.addEventListener("click", () => setTab(button.dataset.tab));
    });

    function updateAppbar() {
        const inRoom = state.room && state.tab !== "home";
        const sub = $("#appbar-sub");

        $("#appbar-main").textContent = inRoom ? state.room.room_name : "Save Memories";
        sub.hidden = !inRoom;
        sub.textContent = inRoom ? `CODE ${state.room.invite_code}` : "";
    }

    /* ------------------------------------------------------------------
       확인 창
    ------------------------------------------------------------------ */
    let confirmResolver = null;

    function confirmDialog({ title, message, okText }) {
        $("#confirm-title").textContent = title;
        $("#confirm-message").textContent = message;
        $("#confirm-ok").textContent = okText;
        $("#confirm-dialog").hidden = false;
        $("#confirm-cancel").focus();

        return new Promise((resolve) => {
            confirmResolver = resolve;
        });
    }

    function closeConfirm(result) {
        $("#confirm-dialog").hidden = true;
        if (confirmResolver) {
            confirmResolver(result);
            confirmResolver = null;
        }
    }

    $("#confirm-ok").addEventListener("click", () => closeConfirm(true));
    $("#confirm-cancel").addEventListener("click", () => closeConfirm(false));
    $("#confirm-dialog").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeConfirm(false);
    });

    /* ------------------------------------------------------------------
       입력 창 (약속 / 폴더 / 사진 설명 공용)
    ------------------------------------------------------------------ */
    let formResolver = null;
    let formFields = [];

    function openForm({ title, fields, submitText = "저장" }) {
        formFields = fields;
        $("#form-title").textContent = title;
        $("#form-submit").textContent = submitText;
        setFormError("#form-error", "");

        const box = $("#form-fields");
        box.replaceChildren();

        fields.forEach((field) => {
            const wrap = document.createElement("label");
            wrap.className = "fd";

            const label = document.createElement("span");
            label.textContent = field.label;
            if (!field.required) {
                const optional = document.createElement("em");
                optional.textContent = " (선택)";
                label.appendChild(optional);
            }

            let input;
            if (field.type === "textarea") {
                input = document.createElement("textarea");
                input.rows = 3;
            } else {
                input = document.createElement("input");
                input.type = field.type || "text";
            }

            input.name = field.name;
            input.value = field.value || "";
            if (field.placeholder) input.placeholder = field.placeholder;
            if (field.maxlength) input.maxLength = field.maxlength;

            wrap.append(label, input);
            box.appendChild(wrap);
        });

        $("#form-dialog").hidden = false;
        const first = box.querySelector("input, textarea");
        if (first) first.focus();

        return new Promise((resolve) => {
            formResolver = resolve;
        });
    }

    function closeForm(values) {
        $("#form-dialog").hidden = true;
        if (formResolver) {
            formResolver(values);
            formResolver = null;
        }
    }

    $("#form-dialog-form").addEventListener("submit", (event) => {
        event.preventDefault();

        const values = {};
        for (const field of formFields) {
            const input = $("#form-fields").querySelector(`[name="${field.name}"]`);
            const value = input.value.trim();

            if (field.required && !value) {
                setFormError("#form-error", `${field.label}을(를) 입력해 주세요.`);
                input.focus();
                return;
            }

            values[field.name] = value;
        }

        closeForm(values);
    });

    $("#form-cancel").addEventListener("click", () => closeForm(null));
    $("#form-close").addEventListener("click", () => closeForm(null));
    $("#form-dialog").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeForm(null);
    });

    /* ------------------------------------------------------------------
       Home: 방 목록, 방 만들기, 코드로 참여, 방 나가기
    ------------------------------------------------------------------ */
    function renderRooms() {
        const grid = $("#room-grid");
        const plusCard = $("#create-room-button");

        grid.querySelectorAll(".room-card:not(.new)").forEach((node) => node.remove());

        $("#room-count").textContent = state.rooms.length ? `${state.rooms.length}개` : "";

        state.rooms.forEach((room) => {
            const card = document.createElement("article");
            card.className = "room-card";
            card.tabIndex = 0;
            card.setAttribute("role", "button");
            card.dataset.roomId = String(room.room_id);
            if (state.room && state.room.room_id === room.room_id) card.classList.add("current");

            const iconBox = document.createElement("span");
            iconBox.className = "rc-icon";
            iconBox.appendChild(icon("home"));

            const name = document.createElement("strong");
            name.className = "rc-name";
            name.textContent = room.room_name;

            const meta = document.createElement("div");
            meta.className = "rc-meta";

            const code = document.createElement("span");
            code.className = "rc-code";
            code.textContent = room.invite_code;

            const count = document.createElement("span");
            count.textContent = `${room.member_count || 1}명`;

            meta.append(code, count);

            const leave = document.createElement("button");
            leave.type = "button";
            leave.className = "rc-leave icon-btn";
            leave.dataset.leave = String(room.room_id);
            leave.title = "방 나가기";
            leave.setAttribute("aria-label", `${room.room_name} 나가기`);
            leave.appendChild(icon("logout"));

            card.append(iconBox, name, meta, leave);

            if (room.role === "owner") {
                const owner = document.createElement("span");
                owner.className = "rc-owner";
                owner.textContent = "방장";
                card.appendChild(owner);
            }

            grid.insertBefore(card, plusCard);
        });
    }

    $("#room-grid").addEventListener("click", (event) => {
        const leaveButton = event.target.closest("[data-leave]");
        if (leaveButton) {
            event.stopPropagation();
            leaveRoom(Number(leaveButton.dataset.leave));
            return;
        }

        const card = event.target.closest(".room-card:not(.new)");
        if (card) openRoom(Number(card.dataset.roomId), "calendar");
    });

    $("#room-grid").addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target.closest(".room-card:not(.new)");
        if (card && event.target === card) {
            event.preventDefault();
            openRoom(Number(card.dataset.roomId), "calendar");
        }
    });

    async function loadRooms() {
        try {
            state.rooms = await api("/api/rooms");
            renderRooms();
        } catch (error) {
            handleError(error);
        }
    }

    // + 새 방 만들기: 방을 만들고 바로 그 방(Room 탭)으로 이동 + 코드/링크 창
    $("#create-room-button").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;

        try {
            const data = await api("/api/rooms", { method: "POST", body: {} });
            await loadRooms();
            const ok = await openRoom(data.room.room_id, "room");
            if (ok) openShareDialog();
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
            toast("방에 참여했어요!");
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

    async function leaveRoom(roomId) {
        const room = state.rooms.find((item) => item.room_id === roomId)
            || (state.room && state.room.room_id === roomId ? state.room : null);

        if (!room) return;

        const members = room.member_count || state.members.length || 1;
        const isOwner = room.role === "owner";

        let message = "내가 고른 날짜는 사라지고, 코드로 다시 들어올 수 있어요.";
        if (members <= 1) {
            message = "마지막 멤버가 나가면 방과 사진이 모두 삭제돼요. 되돌릴 수 없어요.";
        } else if (isOwner) {
            message = "방장이 나가면 다음 멤버가 방장이 돼요. 내가 고른 날짜는 사라져요.";
        }

        const ok = await confirmDialog({
            title: `'${room.room_name}' 방을 나갈까요?`,
            message,
            okText: "나가기"
        });

        if (!ok) return;

        const leavingCurrent = state.room && state.room.room_id === roomId;

        if (leavingCurrent) {
            clearTimeout(state.saveTimer);
            state.saveTimer = null;
            state.dirty = false;
        }

        try {
            const data = await api(`/api/rooms/${roomId}/leave`, { method: "POST" });

            if (leavingCurrent) {
                state.room = null;
                state.members = [];
                state.mine = new Set();
                state.photos = [];
                state.appts = [];
                state.folders = [];
                state.folder = null;
            }

            await loadRooms();
            setTab("home");
            toast(data.room_deleted ? "방을 나갔고, 방이 삭제되었어요." : "방을 나갔어요.");
        } catch (error) {
            handleError(error);
        }
    }

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
        state.photos = [];
        state.appts = [];
        state.folders = [];
        state.folder = null;
        state.apptsExpanded = false;
        state.dirty = false;

        const ok = await fetchRoom();
        if (!ok) return false;

        renderRooms();
        setTab(tab);
        return true;
    }

    async function fetchRoom() {
        if (!state.room) return false;

        const roomId = state.room.room_id;

        try {
            const data = await api(`/api/rooms/${roomId}`);

            // 응답을 기다리는 동안 다른 방으로 바뀌었다면 무시
            if (!state.room || state.room.room_id !== roomId) return false;

            const known = state.rooms.find((room) => room.room_id === roomId);
            state.room = { ...(known || {}), ...data.room };
            state.members = data.members.map((member) => ({
                ...member,
                dateSet: new Set(member.dates)
            }));

            // 내가 막 누른 날짜가 저장되기 전에는 서버 값으로 덮어쓰지 않음
            if (!state.dirty) {
                const me = state.members.find((member) => member.is_me);
                state.mine = new Set(me ? me.dates : []);
            }

            updateAppbar();

            if (state.tab === "calendar" && state.calView === "dates") renderCalendarTab();
            if (state.tab === "room") renderRoomTab();
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
       Room 탭: 코드 / 링크 / 멤버 / 방 나가기
    ------------------------------------------------------------------ */
    function renderRoomTab() {
        const hasRoom = Boolean(state.room);

        $("#room-empty").hidden = hasRoom;
        $("#room-detail").hidden = !hasRoom;

        if (!hasRoom) return;

        $("#share-code").textContent = state.room.invite_code;
        $("#share-link").textContent = inviteLink(state.room.invite_code);
        $("#share-native").hidden = typeof navigator.share !== "function";
        $("#member-count").textContent = `${state.members.length}명`;

        const list = $("#member-list");
        list.replaceChildren();

        state.members.forEach((member) => {
            const item = document.createElement("li");

            const info = document.createElement("div");
            info.className = "member-info";

            const name = document.createElement("span");
            name.className = "member-name";
            name.textContent = member.is_me ? `${member.nickname} (나)` : member.nickname;

            const days = document.createElement("span");
            days.className = "member-days";
            const count = member.is_me ? state.mine.size : member.dateSet.size;
            days.textContent = count > 0 ? `${count}일 선택` : "아직 선택 안 함";

            info.append(name, days);
            item.append(makeAvatar(member), info);

            if (member.role === "owner") {
                const badge = document.createElement("span");
                badge.className = "badge";
                badge.textContent = "방장";
                item.appendChild(badge);
            }

            list.appendChild(item);
        });
    }

    async function copyWithToast(text, okMessage) {
        const ok = await copyToClipboard(text);
        toast(ok ? okMessage : "복사하지 못했어요. 직접 선택해서 복사해 주세요.");
    }

    $("#copy-code").addEventListener("click", () => {
        if (state.room) copyWithToast(state.room.invite_code, "코드가 복사되었어요.");
    });
    $("#copy-link").addEventListener("click", () => {
        if (state.room) copyWithToast(inviteLink(state.room.invite_code), "초대 링크가 복사되었어요.");
    });
    $("#share-native").addEventListener("click", async () => {
        if (!state.room) return;
        try {
            await navigator.share({
                title: "Save Memories",
                text: `'${state.room.room_name}' 방에 참여해요! 코드: ${state.room.invite_code}`,
                url: inviteLink(state.room.invite_code)
            });
        } catch (error) {
            // 공유를 취소한 경우 등은 무시
        }
    });
    $("#leave-room-button").addEventListener("click", () => {
        if (state.room) leaveRoom(state.room.room_id);
    });

    /* ------------------------------------------------------------------
       방 만들기 직후 뜨는 코드/링크 창
    ------------------------------------------------------------------ */
    function openShareDialog() {
        if (!state.room) return;
        $("#dlg-code").textContent = state.room.invite_code;
        $("#dlg-link").textContent = inviteLink(state.room.invite_code);
        $("#share-dialog").hidden = false;
    }

    function closeShareDialog() {
        $("#share-dialog").hidden = true;
    }

    // X 로 닫으면 바로 날짜 정하는 달력 화면으로 이동
    function closeShareAndGoCalendar() {
        closeShareDialog();
        setTab("calendar");
    }

    $("#dlg-close").addEventListener("click", closeShareAndGoCalendar);
    $("#dlg-go").addEventListener("click", closeShareAndGoCalendar);
    $("#share-dialog").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeShareAndGoCalendar();
    });
    $("#dlg-copy-code").addEventListener("click", () => {
        if (state.room) copyWithToast(state.room.invite_code, "코드가 복사되었어요.");
    });
    $("#dlg-copy-link").addEventListener("click", () => {
        if (state.room) copyWithToast(inviteLink(state.room.invite_code), "초대 링크가 복사되었어요.");
    });

    /* ------------------------------------------------------------------
       Calendar 탭: 되는 날짜 고르기
    ------------------------------------------------------------------ */
    function renderCalendarTab() {
        const hasRoom = Boolean(state.room);

        $("#calendar-empty").hidden = hasRoom;
        $("#calendar-area").hidden = !hasRoom;

        if (!hasRoom) return;

        renderCalendar();
        renderLegend();
        renderBestDates();
        renderMemberStrip();
        applyCalView();
    }

    function applyCalView() {
        document.querySelectorAll(".seg-btn").forEach((button) => {
            button.classList.toggle("active", button.dataset.calView === state.calView);
        });

        $("#cal-view-dates").hidden = state.calView !== "dates";
        $("#cal-view-list").hidden = state.calView !== "list";
    }

    document.querySelectorAll(".seg-btn").forEach((button) => {
        button.addEventListener("click", () => {
            state.calView = button.dataset.calView;
            applyCalView();
            if (state.calView === "list") loadAppts();
        });
    });

    function ownersOf(dateStr) {
        return state.members.filter((member) =>
            member.is_me ? state.mine.has(dateStr) : member.dateSet.has(dateStr)
        );
    }

    function renderMemberStrip() {
        const stack = $("#members-avatars");
        stack.replaceChildren();
        state.members.forEach((member) => stack.appendChild(makeAvatar(member)));
    }

    function renderCalendar() {
        const { year, month } = state;
        const today = todayString();
        const me = state.members.find((member) => member.is_me);

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
            const weekday = new Date(year, month, day).getDay();

            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "day";
            cell.dataset.date = dateStr;
            cell.style.setProperty("--c", me ? me.color : "#8ccbff");
            cell.setAttribute("aria-label", `${month + 1}월 ${day}일`);
            cell.setAttribute("aria-pressed", String(state.mine.has(dateStr)));

            if (weekday === 6) cell.classList.add("sat");
            if (weekday === 0) cell.classList.add("sun");
            if (dateStr === today) cell.classList.add("today");
            if (state.mine.has(dateStr)) cell.classList.add("mine");
            if (state.members.length > 1 && owners.length === state.members.length) {
                cell.classList.add("all");
            }

            const number = document.createElement("span");
            number.className = "n";
            number.textContent = String(day);
            cell.appendChild(number);

            if (owners.length > 0) {
                const dots = document.createElement("span");
                dots.className = "dots";

                owners.forEach((member) => {
                    const dot = document.createElement("i");
                    dot.className = "dot";
                    dot.style.backgroundColor = member.color;
                    dot.title = member.nickname;
                    dots.appendChild(dot);
                });

                cell.appendChild(dots);
            }

            grid.appendChild(cell);
        }
    }

    function renderLegend() {
        const legend = $("#cal-legend");
        legend.replaceChildren();

        state.members.forEach((member) => {
            const item = document.createElement("li");
            const dot = document.createElement("i");
            dot.style.backgroundColor = member.color;

            item.append(dot, document.createTextNode(member.is_me ? `${member.nickname} (나)` : member.nickname));
            legend.appendChild(item);
        });
    }

    // 2명 이상 겹치는 날짜 중 상위 3개 (오늘 이후만)
    function bestDates() {
        if (state.members.length < 2) return [];

        const today = todayString();
        const counts = new Map();

        state.members.forEach((member) => {
            const dates = member.is_me ? state.mine : member.dateSet;
            dates.forEach((date) => {
                if (date < today) return;
                if (!counts.has(date)) counts.set(date, []);
                counts.get(date).push(member);
            });
        });

        return [...counts.entries()]
            .filter(([, members]) => members.length >= 2)
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .slice(0, 3);
    }

    function renderBestDates() {
        const list = $("#best-list");
        list.replaceChildren();

        const best = bestDates();
        $("#best-empty").hidden = best.length > 0;

        best.forEach(([date, members]) => {
            const [year, month, day] = date.split("-").map(Number);
            const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];

            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";

            const label = document.createElement("span");
            label.textContent = `${month}월 ${day}일 (${weekday})`;

            const meta = document.createElement("span");
            meta.className = "best-meta";

            const stack = document.createElement("span");
            stack.className = "avatar-stack";
            members.forEach((member) => stack.appendChild(makeAvatar(member, true)));

            const count = document.createElement("span");
            count.textContent = `${members.length}/${state.members.length}명`;

            meta.append(stack, count);
            button.append(label, meta);

            button.addEventListener("click", () => {
                state.year = year;
                state.month = month - 1;
                renderCalendar();
                $(".tab-panels").scrollTo({ top: 0, behavior: "smooth" });
            });

            const add = document.createElement("button");
            add.type = "button";
            add.className = "best-add";
            add.textContent = "약속 잡기";
            add.addEventListener("click", () => createAppointment(date));

            item.append(button, add);
            list.appendChild(item);
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
        renderBestDates();
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

    function setSaveState(text, ok = false) {
        const el = $("#save-state");
        el.textContent = text;
        el.classList.toggle("ok", ok);
    }

    function scheduleSave() {
        state.dirty = true;
        setSaveState("저장 중…");
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
            if (!state.saveTimer) setSaveState("저장됨 ✓", true);
        } catch (error) {
            setSaveState("저장 실패");
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
       약속 목록
    ------------------------------------------------------------------ */
    function formatDotDate(date) {
        const [year, month, day] = date.split("-");
        return `${year}.${month}.${day}.`;
    }

    function orderedAppts() {
        const today = todayString();
        const key = (item) => `${item.date} ${item.time}`;
        const upcoming = state.appts.filter((item) => item.date >= today)
            .sort((a, b) => key(a).localeCompare(key(b)));
        const past = state.appts.filter((item) => item.date < today)
            .sort((a, b) => key(b).localeCompare(key(a)));

        return [...upcoming, ...past];
    }

    async function loadAppts() {
        if (!state.room) return;

        const roomId = state.room.room_id;

        try {
            const list = await api(`/api/rooms/${roomId}/appointments`);
            if (!state.room || state.room.room_id !== roomId) return;

            state.appts = list;
            renderAppts();
        } catch (error) {
            handleError(error);
        }
    }

    function renderAppts() {
        const list = $("#appt-list");
        list.replaceChildren();

        const ordered = orderedAppts();
        const today = todayString();
        const limit = state.apptsExpanded ? ordered.length : 3;

        $("#appt-empty").hidden = ordered.length > 0;

        ordered.slice(0, limit).forEach((appt) => {
            const item = document.createElement("li");
            item.className = "appt";
            if (appt.date < today) item.classList.add("past");

            const main = document.createElement("div");
            main.className = "appt-main";

            const title = document.createElement("span");
            title.className = "appt-title";
            const timeText = appt.time && appt.time !== "00:00" ? ` ${appt.time}` : "";
            title.textContent = `${formatDotDate(appt.date)}${timeText} - ${appt.title}`;
            main.appendChild(title);

            if (appt.place) {
                const place = document.createElement("span");
                place.className = "appt-sub";
                place.append(icon("pin"), document.createTextNode(appt.place));
                main.appendChild(place);
            }

            if (appt.description) {
                const memo = document.createElement("p");
                memo.className = "appt-memo";
                memo.textContent = appt.description;
                main.appendChild(memo);
            }

            const actions = document.createElement("div");
            actions.className = "appt-actions";

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "icon-btn";
            edit.setAttribute("aria-label", "약속 수정");
            edit.appendChild(icon("pencil"));
            edit.addEventListener("click", () => editAppointment(appt));

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "icon-btn danger";
            remove.setAttribute("aria-label", "약속 삭제");
            remove.appendChild(icon("trash"));
            remove.addEventListener("click", () => deleteAppointment(appt));

            actions.append(edit, remove);
            item.append(main, actions);
            list.appendChild(item);
        });

        const more = $("#appt-more");
        more.hidden = ordered.length <= 3;
        more.textContent = state.apptsExpanded ? "접기" : "더보기..";
    }

    $("#appt-more").addEventListener("click", () => {
        state.apptsExpanded = !state.apptsExpanded;
        renderAppts();
    });

    function appointmentFields(appt = {}, presetDate = "") {
        return [
            { name: "date", label: "날짜", type: "date", required: true, value: appt.date || presetDate || todayString() },
            { name: "time", label: "시간", type: "time", value: appt.time && appt.time !== "00:00" ? appt.time : "" },
            { name: "title", label: "뭐 하고 놀까요?", required: true, maxlength: 200, placeholder: "예: 홍대 놀러가기", value: appt.title || "" },
            { name: "place", label: "장소", maxlength: 255, placeholder: "예: 홍대입구역 9번 출구", value: appt.place || "" },
            { name: "description", label: "메모", type: "textarea", maxlength: 2000, placeholder: "가고 싶은 곳, 먹을 것, 준비물 등을 적어 보세요.", value: appt.description || "" }
        ];
    }

    async function createAppointment(presetDate = "") {
        if (!state.room) return;

        const values = await openForm({
            title: "약속 잡기",
            fields: appointmentFields({}, presetDate),
            submitText: "등록"
        });

        if (!values) return;

        try {
            await api(`/api/rooms/${state.room.room_id}/appointments`, { method: "POST", body: values });
            toast("약속을 잡았어요!");

            state.calView = "list";
            applyCalView();
            await loadAppts();
        } catch (error) {
            handleError(error);
        }
    }

    async function editAppointment(appt) {
        if (!state.room) return;

        const values = await openForm({
            title: "약속 수정",
            fields: appointmentFields(appt)
        });

        if (!values) return;

        try {
            await api(`/api/rooms/${state.room.room_id}/appointments/${appt.appointment_id}`, {
                method: "PUT",
                body: values
            });
            toast("약속을 수정했어요.");
            await loadAppts();
        } catch (error) {
            handleError(error);
        }
    }

    async function deleteAppointment(appt) {
        if (!state.room) return;

        const ok = await confirmDialog({
            title: "약속을 삭제할까요?",
            message: `'${appt.title}' 약속이 삭제돼요.`,
            okText: "삭제"
        });

        if (!ok) return;

        try {
            await api(`/api/rooms/${state.room.room_id}/appointments/${appt.appointment_id}`, { method: "DELETE" });
            toast("약속을 삭제했어요.");
            await loadAppts();
        } catch (error) {
            handleError(error);
        }
    }

    $("#appt-add").addEventListener("click", () => createAppointment());

    /* ------------------------------------------------------------------
       Picture 탭: 날짜별 폴더 → 사진 → 상세(좋아요 / 수정 / 삭제 / 다운로드)
    ------------------------------------------------------------------ */
    function renderPictureTab() {
        const hasRoom = Boolean(state.room);

        $("#picture-empty").hidden = hasRoom;
        $("#picture-area").hidden = !hasRoom;

        if (!hasRoom) return;

        if (state.folder) {
            showAlbum();
        } else {
            showFolderView();
            loadFolders();
        }
    }

    function showFolderView() {
        $("#folder-view").hidden = false;
        $("#album-view").hidden = true;
    }

    function folderLabel(folder) {
        const parts = [];
        if (folder.folder_date) parts.push(formatDotDate(folder.folder_date).slice(2));
        parts.push(`${folder.photo_count}장`);
        return parts.join(" · ");
    }

    async function loadFolders() {
        if (!state.room) return;

        const roomId = state.room.room_id;

        try {
            const folders = await api(`/api/rooms/${roomId}/folders`);
            if (!state.room || state.room.room_id !== roomId) return;

            state.folders = folders;
            renderFolders();
        } catch (error) {
            handleError(error);
        }
    }

    function renderFolders() {
        const grid = $("#folder-grid");
        const addCard = $("#folder-add");

        grid.querySelectorAll(".folder-card:not(.new)").forEach((node) => node.remove());
        $("#folder-count").textContent = state.folders.length ? `${state.folders.length}개` : "";

        state.folders.forEach((folder) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "folder-card";

            const iconBox = document.createElement("span");
            iconBox.className = "folder-icon";
            iconBox.appendChild(icon("folder"));

            if (folder.cover) {
                const cover = document.createElement("img");
                cover.className = "cover";
                cover.src = folder.cover;
                cover.alt = "";
                cover.loading = "lazy";
                iconBox.appendChild(cover);
            }

            const name = document.createElement("span");
            name.className = "folder-name";
            name.textContent = folder.name;

            const meta = document.createElement("span");
            meta.className = "folder-meta";
            meta.textContent = folderLabel(folder);

            card.append(iconBox, name, meta);
            card.addEventListener("click", () => openFolder(folder));
            grid.insertBefore(card, addCard);
        });
    }

    $("#folder-add").addEventListener("click", async () => {
        if (!state.room) return;

        const values = await openForm({
            title: "새 폴더",
            submitText: "만들기",
            fields: [
                { name: "name", label: "폴더 이름", required: true, maxlength: 100, placeholder: "예: 홍대 놀러간 날" },
                { name: "folder_date", label: "날짜", type: "date", value: todayString() },
                { name: "note", label: "글", type: "textarea", maxlength: 500, placeholder: "그날의 한 줄 기록을 남겨 보세요." }
            ]
        });

        if (!values) return;

        try {
            const data = await api(`/api/rooms/${state.room.room_id}/folders`, { method: "POST", body: values });
            toast("폴더를 만들었어요!");
            await openFolder({
                folder_id: data.folder_id,
                name: values.name,
                folder_date: values.folder_date || null,
                note: values.note,
                photo_count: 0
            });
        } catch (error) {
            handleError(error);
        }
    });

    async function openFolder(folder) {
        state.folder = folder;
        state.photos = [];
        showAlbum();
        await loadPhotos();
    }

    function showAlbum() {
        const folder = state.folder;
        if (!folder) return;

        $("#folder-view").hidden = true;
        $("#album-view").hidden = false;

        $("#album-name").textContent = folder.name;
        $("#album-date").textContent = folder.folder_date ? formatDotDate(folder.folder_date) : "";

        const note = $("#album-note");
        note.textContent = folder.note || "";
        note.hidden = !folder.note;

        // '분류 없음'(예전 사진)은 수정/삭제 불가
        const virtual = folder.folder_id === 0;
        $("#album-edit").hidden = virtual;
        $("#album-delete").hidden = virtual;

        renderPhotos();
    }

    $("#album-back").addEventListener("click", () => {
        state.folder = null;
        state.photos = [];
        showFolderView();
        loadFolders();
    });

    $("#album-edit").addEventListener("click", async () => {
        const folder = state.folder;
        if (!state.room || !folder) return;

        const values = await openForm({
            title: "폴더 수정",
            fields: [
                { name: "name", label: "폴더 이름", required: true, maxlength: 100, value: folder.name },
                { name: "folder_date", label: "날짜", type: "date", value: folder.folder_date || "" },
                { name: "note", label: "글", type: "textarea", maxlength: 500, value: folder.note || "" }
            ]
        });

        if (!values) return;

        try {
            await api(`/api/rooms/${state.room.room_id}/folders/${folder.folder_id}`, { method: "PUT", body: values });
            state.folder = { ...folder, name: values.name, folder_date: values.folder_date || null, note: values.note };
            toast("폴더를 수정했어요.");
            showAlbum();
        } catch (error) {
            handleError(error);
        }
    });

    $("#album-delete").addEventListener("click", async () => {
        const folder = state.folder;
        if (!state.room || !folder) return;

        const count = state.photos.length;
        const ok = await confirmDialog({
            title: `'${folder.name}' 폴더를 삭제할까요?`,
            message: count > 0 ? `안에 있는 사진 ${count}장도 함께 삭제돼요. 되돌릴 수 없어요.` : "빈 폴더가 삭제돼요.",
            okText: "삭제"
        });

        if (!ok) return;

        try {
            await api(`/api/rooms/${state.room.room_id}/folders/${folder.folder_id}`, { method: "DELETE" });
            toast("폴더를 삭제했어요.");
            state.folder = null;
            state.photos = [];
            showFolderView();
            await loadFolders();
        } catch (error) {
            handleError(error);
        }
    });

    function uploaderName(userId) {
        const member = state.members.find((item) => item.user_id === userId);
        return member ? member.nickname : "";
    }

    async function loadPhotos() {
        if (!state.room || !state.folder) return;

        const roomId = state.room.room_id;
        const folderId = state.folder.folder_id;

        try {
            const photos = await api(`/api/rooms/${roomId}/photos?folder_id=${folderId || "none"}`);
            if (!state.room || state.room.room_id !== roomId || !state.folder || state.folder.folder_id !== folderId) return;

            state.photos = photos;
            state.folder = { ...state.folder, photo_count: photos.length };
            renderPhotos();
        } catch (error) {
            handleError(error);
        }
    }

    function renderPhotos() {
        const grid = $("#photo-grid");
        grid.replaceChildren();
        $("#photo-empty").hidden = state.photos.length > 0;

        state.photos.forEach((photo, index) => {
            const tile = document.createElement("button");
            tile.type = "button";
            tile.className = "photo-tile";
            tile.setAttribute("aria-label", photo.caption || "사진 보기");

            const img = document.createElement("img");
            img.src = photo.file_path;
            img.alt = photo.caption || "방 사진";
            img.loading = "lazy";
            tile.appendChild(img);

            if (photo.like_count > 0) {
                const like = document.createElement("span");
                like.className = "photo-like";
                like.append(icon("heart"), document.createTextNode(String(photo.like_count)));
                tile.appendChild(like);
            }

            tile.addEventListener("click", () => openViewer(index));
            grid.appendChild(tile);
        });
    }

    $("#photo-add").addEventListener("click", () => $("#photo-input").click());

    $("#photo-input").addEventListener("change", async (event) => {
        const input = event.currentTarget;
        const files = [...input.files];
        input.value = "";

        if (!files.length || !state.room || !state.folder) return;

        const roomId = state.room.room_id;
        const folderId = state.folder.folder_id;
        let uploaded = 0;

        for (const file of files) {
            if (file.size > 5 * 1024 * 1024) {
                toast(`'${file.name}'은(는) 5MB를 넘어서 건너뛰었어요.`);
                continue;
            }

            const formData = new FormData();
            formData.append("folder_id", String(folderId || ""));
            formData.append("photo", file);

            try {
                await api(`/api/rooms/${roomId}/photos`, { method: "POST", body: formData });
                uploaded += 1;
            } catch (error) {
                handleError(error);
            }
        }

        if (uploaded > 0) {
            toast(`사진 ${uploaded}장을 올렸어요!`);
            await loadPhotos();
        }
    });

    /* ---------- 사진 상세 ---------- */
    function currentPhoto() {
        return state.photos[state.viewerIndex] || null;
    }

    function openViewer(index) {
        state.viewerIndex = index;
        renderViewer();
        $("#lightbox").hidden = false;
    }

    function closeLightbox() {
        $("#lightbox").hidden = true;
        state.viewerIndex = -1;
    }

    function renderViewer() {
        const photo = currentPhoto();
        if (!photo) return;

        $("#lightbox-img").src = photo.file_path;
        $("#lightbox-img").alt = photo.caption || "방 사진";
        $("#lightbox-caption").textContent = photo.caption || "";

        const who = uploaderName(photo.uploader_user_id);
        const when = photo.created_at ? formatDotDate(String(photo.created_at).slice(0, 10)) : "";
        $("#lightbox-meta").textContent = [who, when].filter(Boolean).join(" · ");

        const like = $("#lb-like");
        like.classList.toggle("liked", photo.liked);
        like.setAttribute("aria-pressed", String(photo.liked));
        $("#lb-like-count").textContent = photo.like_count > 0 ? String(photo.like_count) : "";

        const extension = (photo.file_path.match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
        const download = $("#lb-download");
        download.href = photo.file_path;
        download.setAttribute("download", `save-memories-${photo.photo_id}${extension}`);

        $("#lb-prev").hidden = state.viewerIndex <= 0;
        $("#lb-next").hidden = state.viewerIndex >= state.photos.length - 1;
    }

    function stepViewer(delta) {
        const next = state.viewerIndex + delta;
        if (next < 0 || next >= state.photos.length) return;
        state.viewerIndex = next;
        renderViewer();
    }

    $("#lb-prev").addEventListener("click", () => stepViewer(-1));
    $("#lb-next").addEventListener("click", () => stepViewer(1));
    $("#lightbox-close").addEventListener("click", closeLightbox);
    $("#lightbox").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeLightbox();
    });

    $("#lb-like").addEventListener("click", async () => {
        const photo = currentPhoto();
        if (!photo || !state.room) return;

        try {
            const data = await api(`/api/rooms/${state.room.room_id}/photos/${photo.photo_id}/like`, { method: "POST" });
            photo.liked = data.liked;
            photo.like_count = data.like_count;
            renderViewer();
            renderPhotos();
        } catch (error) {
            handleError(error);
        }
    });

    $("#lb-edit").addEventListener("click", async () => {
        const photo = currentPhoto();
        if (!photo || !state.room) return;

        const values = await openForm({
            title: "사진 설명 수정",
            fields: [
                { name: "caption", label: "설명", type: "textarea", maxlength: 500, placeholder: "사진에 대한 한 줄 설명을 적어 보세요.", value: photo.caption || "" }
            ]
        });

        if (!values) return;

        try {
            const data = await api(`/api/rooms/${state.room.room_id}/photos/${photo.photo_id}`, {
                method: "PUT",
                body: { caption: values.caption }
            });
            photo.caption = data.caption;
            toast("설명을 수정했어요.");
            renderViewer();
            renderPhotos();
        } catch (error) {
            handleError(error);
        }
    });

    $("#lb-delete").addEventListener("click", async () => {
        const photo = currentPhoto();
        if (!photo || !state.room) return;

        const ok = await confirmDialog({
            title: "사진을 삭제할까요?",
            message: "삭제한 사진은 되돌릴 수 없어요.",
            okText: "삭제"
        });

        if (!ok) return;

        try {
            await api(`/api/rooms/${state.room.room_id}/photos/${photo.photo_id}`, { method: "DELETE" });
            state.photos.splice(state.viewerIndex, 1);
            toast("사진을 삭제했어요.");
            renderPhotos();

            if (state.photos.length === 0) {
                closeLightbox();
            } else {
                state.viewerIndex = Math.min(state.viewerIndex, state.photos.length - 1);
                renderViewer();
            }
        } catch (error) {
            handleError(error);
        }
    });

    /* ------------------------------------------------------------------
       키보드: Esc 로 열린 창 닫기
    ------------------------------------------------------------------ */
    document.addEventListener("keydown", (event) => {
        if (!$("#lightbox").hidden && $("#form-dialog").hidden && $("#confirm-dialog").hidden) {
            if (event.key === "ArrowLeft") stepViewer(-1);
            if (event.key === "ArrowRight") stepViewer(1);
        }

        if (event.key !== "Escape") return;

        if (!$("#confirm-dialog").hidden) closeConfirm(false);
        else if (!$("#form-dialog").hidden) closeForm(null);
        else if (!$("#lightbox").hidden) closeLightbox();
        else if (!$("#share-dialog").hidden) closeShareAndGoCalendar();
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
