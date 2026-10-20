// Reads the "notes" key with the Marsa SDK. Never put an edit token in a page.
const list = document.getElementById("notes");
const status = document.getElementById("status");

function render(notes) {
  list.textContent = "";
  for (const text of notes) {
    const li = document.createElement("li");
    li.textContent = String(text);
    list.appendChild(li);
  }
  if (!notes.length) list.innerHTML = '<li class="muted">No notes yet.</li>';
}

async function load() {
  try {
    render((await window.marsa.kv.get("notes")) ?? []);
    status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    render([]);
    status.textContent =
      err.code === "BACKEND_NOT_CONFIGURED"
        ? "This Marsa instance has no data backend, so the page is static only."
        : `Couldn't load notes (${err.code || err.message}).`;
  }
}

load();
setInterval(load, 15000);
