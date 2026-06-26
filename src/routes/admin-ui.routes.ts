import type { FastifyInstance } from "fastify";

const adminPairHtml = String.raw`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pocket Gateway Pairing</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111018;
      --panel: #1a1824;
      --panel-2: #211e2d;
      --text: #f5f3ff;
      --muted: #a7a2b8;
      --line: #383348;
      --accent: #9f6cff;
      --ok: #55d68b;
      --err: #ff6b7a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(960px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 36px 0 56px;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 720;
      letter-spacing: 0;
    }
    .sub {
      margin-top: 6px;
      color: var(--muted);
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      gap: 16px;
    }
    section {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 18px;
    }
    h2 {
      margin: 0 0 16px;
      font-size: 16px;
      font-weight: 680;
    }
    label {
      display: block;
      margin: 12px 0 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 620;
    }
    input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #12101a;
      color: var(--text);
      padding: 0 12px;
      font: inherit;
      outline: none;
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(159, 108, 255, 0.18);
    }
    .code {
      font-size: 26px;
      letter-spacing: 6px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }
    button {
      height: 44px;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: white;
      padding: 0 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary {
      background: var(--panel-2);
      border: 1px solid var(--line);
      color: var(--text);
    }
    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 18px;
    }
    .status {
      min-height: 22px;
      margin-top: 14px;
      color: var(--muted);
      font-size: 14px;
    }
    .status.ok { color: var(--ok); }
    .status.err { color: var(--err); }
    .sessions {
      display: grid;
      gap: 10px;
    }
    .session {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #14121d;
      padding: 12px;
    }
    .session strong {
      display: block;
      font-size: 14px;
      margin-bottom: 4px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 14px;
      font-size: 14px;
    }
    @media (max-width: 760px) {
      main { width: min(100vw - 24px, 960px); padding-top: 22px; }
      header { display: block; }
      .grid { grid-template-columns: 1fr; }
      .actions { flex-direction: column; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Pocket Gateway Pairing</h1>
        <div class="sub">Подтверждение 6-значного кода с устройства</div>
      </div>
      <button class="secondary" id="refresh" type="button">Обновить</button>
    </header>

    <div class="grid">
      <section>
        <h2>Подтвердить устройство</h2>
        <form id="confirm-form">
          <label for="admin-key">Admin API key</label>
          <input id="admin-key" autocomplete="current-password" type="password" placeholder="ADMIN_API_KEY">

          <label for="pairing-code">Код с экрана устройства</label>
          <input id="pairing-code" class="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="000000">

          <label for="owner-label">Имя устройства</label>
          <input id="owner-label" maxlength="80" value="Pocket Familiar">

          <div class="actions">
            <button id="confirm" type="submit">Подтвердить</button>
            <button class="secondary" id="clear-key" type="button">Очистить ключ</button>
          </div>
          <div class="status" id="status"></div>
        </form>
      </section>

      <section>
        <h2>Ожидают подтверждения</h2>
        <div class="sessions" id="sessions">
          <div class="empty">Введите Admin API key и нажмите «Обновить».</div>
        </div>
      </section>
    </div>
  </main>

  <script>
    const keyInput = document.querySelector("#admin-key");
    const codeInput = document.querySelector("#pairing-code");
    const ownerInput = document.querySelector("#owner-label");
    const statusEl = document.querySelector("#status");
    const sessionsEl = document.querySelector("#sessions");
    const confirmButton = document.querySelector("#confirm");
    const savedKey = sessionStorage.getItem("pocket_gateway_admin_key");
    if (savedKey) keyInput.value = savedKey;

    function setStatus(text, kind = "") {
      statusEl.textContent = text;
      statusEl.className = "status" + (kind ? " " + kind : "");
    }

    function authHeaders() {
      const key = keyInput.value.trim();
      if (key) sessionStorage.setItem("pocket_gateway_admin_key", key);
      return { "authorization": "Bearer " + key };
    }

    function formatTime(value) {
      return new Date(value).toLocaleString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
    }

    async function loadSessions() {
      if (!keyInput.value.trim()) {
        sessionsEl.innerHTML = '<div class="empty">Введите Admin API key и нажмите «Обновить».</div>';
        return;
      }
      const res = await fetch("/api/v1/admin/pair/pending", { headers: authHeaders() });
      if (!res.ok) {
        sessionsEl.innerHTML = '<div class="empty">Не удалось загрузить pending-сессии. Проверьте Admin API key.</div>';
        return;
      }
      const data = await res.json();
      if (!data.sessions.length) {
        sessionsEl.innerHTML = '<div class="empty">Сейчас нет активных pending-сессий.</div>';
        return;
      }
      sessionsEl.replaceChildren(...data.sessions.map((session) => {
        const item = document.createElement("div");
        item.className = "session";
        item.innerHTML =
          '<strong>' + escapeHtml(session.device_name) + '</strong>' +
          '<div class="meta">' + escapeHtml(session.hardware) + '</div>' +
          '<div class="meta">Firmware ' + escapeHtml(session.firmware_version) + '</div>' +
          '<div class="meta">Expires ' + formatTime(session.expires_at) + '</div>';
        return item;
      }));
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch]));
    }

    document.querySelector("#refresh").addEventListener("click", () => {
      loadSessions().catch(() => setStatus("Не удалось обновить список.", "err"));
    });

    document.querySelector("#clear-key").addEventListener("click", () => {
      sessionStorage.removeItem("pocket_gateway_admin_key");
      keyInput.value = "";
      keyInput.focus();
      setStatus("Ключ очищен.");
      sessionsEl.innerHTML = '<div class="empty">Введите Admin API key и нажмите «Обновить».</div>';
    });

    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
    });

    document.querySelector("#confirm-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const pairingCode = codeInput.value.trim();
      const ownerLabel = ownerInput.value.trim();
      if (!keyInput.value.trim()) return setStatus("Введите Admin API key.", "err");
      if (!/^\d{6}$/.test(pairingCode)) return setStatus("Введите 6 цифр с экрана устройства.", "err");
      if (!ownerLabel) return setStatus("Введите имя устройства.", "err");

      confirmButton.disabled = true;
      setStatus("Подтверждаю...");
      try {
        const res = await fetch("/api/v1/admin/pair/confirm", {
          method: "POST",
          headers: { ...authHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ pairing_code: pairingCode, owner_label: ownerLabel })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error?.message || "Pairing failed");
        setStatus("Устройство подтверждено: " + data.device_id, "ok");
        codeInput.value = "";
        await loadSessions();
      } catch (error) {
        setStatus(error.message || "Не удалось подтвердить устройство.", "err");
      } finally {
        confirmButton.disabled = false;
      }
    });

    if (savedKey) loadSessions().catch(() => undefined);
  </script>
</body>
</html>`;

export async function adminUiRoutes(app: FastifyInstance) {
  app.get("/admin", async (_request, reply) => reply.redirect("/admin/pair"));
  app.get("/admin/pair", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return adminPairHtml;
  });
}
