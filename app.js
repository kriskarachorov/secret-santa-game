(() => {
  "use strict";

  const API_URL = (window.SECRET_SANTA_CONFIG?.apiUrl || "").trim().replace(/\/$/, "");
  const ANON_KEY = (window.SECRET_SANTA_CONFIG?.anonKey || "").trim();
  const KEY = "classSecretSanta2026AccessCode";
  const $ = (selector) => document.querySelector(selector);
  const state = { code: localStorage.getItem(KEY) || "", participant: null, settings: null };

  const els = {
    joinForm: $("#join-form"), name: $("#participant-name"), wishlist: $("#wishlist"), joinButton: $("#join-submit"), joinStatus: $("#join-status"),
    restoreForm: $("#restore-form"), restoreCode: $("#restore-code"), restoreStatus: $("#restore-status"),
    participants: $("#participant-list"), count: $("#participant-count"), signupState: $("#signup-state"), countdownTitle: $("#countdown-title"), countdownNote: $("#countdown-note"),
    reveal: $("#reveal-card"), revealHint: $("#reveal-hint"), revealButton: $("#reveal-button"), organizerCode: $("#organizer-code"), adminStatus: $("#admin-status"),
  };

  function setStatus(element, message, error = false) {
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    window.setTimeout(() => element.classList.remove("show"), 2600);
  }

  async function request(action, payload = {}) {
    if (!API_URL || !ANON_KEY) throw new Error("The shared event backend is not connected yet. No information has been saved.");
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch {
      throw new Error("Couldn’t reach the shared event service. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function formatDate(value) {
    const date = new Date(`${value}T12:00:00`);
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(date);
  }

  function renderPublic(data) {
    const names = Array.isArray(data.participants) ? data.participants : [];
    els.count.textContent = String(names.length);
    els.participants.replaceChildren();
    if (!names.length) {
      const li = document.createElement("li");
      li.className = "empty-list";
      li.textContent = data.settings?.signups_open ? "Be the first to join the exchange." : "Your classmates will appear here when signups open.";
      els.participants.append(li);
    } else {
      names.forEach((person) => {
        const li = document.createElement("li");
        li.textContent = person.name;
        els.participants.append(li);
      });
    }

    state.settings = data.settings || {};
    els.signupState.textContent = state.settings.signups_open ? "Signups are open" : "Signups are closed";
    els.joinButton.disabled = !state.settings.signups_open;
    const selected = state.settings.selected_date;
    if (selected) {
      els.countdownTitle.textContent = formatDate(selected);
      els.countdownNote.textContent = "We’ll meet at school, swap gifts, then head out together.";
      startCountdown(selected);
    } else {
      els.countdownTitle.textContent = "Friday, 18 December";
      els.countdownNote.textContent = "Friday, December 18, 2026";
      ["days", "hours", "minutes", "seconds"].forEach((id) => { $(`#${id}`).textContent = "—"; });
    }

    $("#admin-signups").checked = Boolean(state.settings.signups_open);
    if (selected) $("#admin-date").value = selected;
    const hasDraw = Boolean(state.settings.draw_complete);
    els.reveal.hidden = !state.code;
    if (state.code) {
      els.revealButton.disabled = !hasDraw;
      els.revealHint.textContent = hasDraw ? "The draw is ready. Your person is waiting below the wrapping paper." : "The draw is still wrapped up. We’ll let you know when it’s time.";
    }
  }

  let countdownTimer;
  function startCountdown(dateString) {
    if (countdownTimer) clearInterval(countdownTimer);
    const target = new Date(`${dateString}T09:00:00+02:00`).getTime();
    const tick = () => {
      const remaining = Math.max(0, target - Date.now());
      const values = {
        days: Math.floor(remaining / 86400000),
        hours: Math.floor((remaining % 86400000) / 3600000),
        minutes: Math.floor((remaining % 3600000) / 60000),
        seconds: Math.floor((remaining % 60000) / 1000),
      };
      Object.entries(values).forEach(([id, value]) => { $(`#${id}`).textContent = String(value).padStart(2, "0"); });
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function refresh() {
    if (!API_URL || !ANON_KEY) {
      const message = "Shared signups aren’t connected yet. This page will not save names until the shared service is set up.";
      els.joinButton.disabled = true;
      els.restoreForm.querySelector("button").disabled = true;
      els.signupState.textContent = "Not connected yet";
      setStatus(els.joinStatus, message);
      $("#countdown-note").textContent = "Friday, December 18, 2026";
      return;
    }
    try {
      const data = await request("public");
      renderPublic(data);
      setStatus(els.joinStatus, state.settings?.signups_open ? "Signups are open. Add your name when you’re ready." : "Signups are not open right now.");
      if (state.code) {
        const own = await request("restore", { accessCode: state.code });
        state.participant = own.participant;
        renderPublic(data);
      }
    } catch (error) {
      els.joinButton.disabled = true;
      setStatus(els.joinStatus, `Shared event service unavailable: ${error.message}`, true);
    }
  }

  els.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!API_URL) return;
    els.joinButton.disabled = true;
    setStatus(els.joinStatus, "Adding your name to the class list…");
    try {
      const result = await request("join", { name: els.name.value.trim(), wishlist: els.wishlist.value.trim() });
      state.code = result.accessCode;
      localStorage.setItem(KEY, state.code);
      state.participant = result.participant;
      $("#new-code").textContent = state.code;
      $("#code-dialog").showModal();
      els.joinForm.reset();
      setStatus(els.joinStatus, "You’re in the hat. Save your private code before closing this window.");
      await refresh();
    } catch (error) {
      setStatus(els.joinStatus, error.message, true);
      els.joinButton.disabled = Boolean(state.settings && !state.settings.signups_open);
    }
  });

  els.restoreForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!API_URL) return;
    const accessCode = els.restoreCode.value.trim();
    setStatus(els.restoreStatus, "Checking your code…");
    try {
      const result = await request("restore", { accessCode });
      state.code = accessCode;
      state.participant = result.participant;
      localStorage.setItem(KEY, state.code);
      setStatus(els.restoreStatus, `Welcome back, ${result.participant.name}. This device is ready.`);
      await refresh();
    } catch (error) {
      setStatus(els.restoreStatus, error.message, true);
    }
  });

  $("#copy-code").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.code); setStatus($("#code-status"), "Copied. Keep it somewhere private."); }
    catch { setStatus($("#code-status"), "Select and copy the code above to save it.", true); }
  });
  $("#download-code").addEventListener("click", () => {
    const blob = new Blob([`Class Secret Santa 2026\nPrivate reveal code: ${state.code}\n\nKeep this note private. You’ll need the code to reveal your recipient on another device.`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "secret-santa-private-code.txt"; link.click(); URL.revokeObjectURL(url);
    setStatus($("#code-status"), "Saved as a note. Keep it private.");
  });

  els.revealButton.addEventListener("click", async () => {
    els.revealButton.disabled = true;
    try {
      const result = await request("reveal", { accessCode: state.code });
      els.revealHint.replaceChildren();
      const message = document.createElement("span");
      message.textContent = `You drew ${result.recipient.name}.`;
      message.style.cssText = "display:block;font:600 24px 'Playfair Display',Georgia,serif;color:#f0d998;margin-bottom:7px";
      const hint = document.createElement("span");
      hint.textContent = result.recipient.wishlist || "No gift hints yet—think about what would make them smile.";
      els.revealHint.append(message, hint);
      els.revealButton.textContent = "Recipient revealed";
    } catch (error) {
      setStatus(els.joinStatus, error.message, true);
      els.revealButton.disabled = false;
    }
  });

  async function adminRequest(action, extra = {}) {
    const organizerCode = els.organizerCode.value;
    if (!organizerCode) throw new Error("Enter the organizer code first.");
    return request("admin", { organizerCode, operation: action, ...extra });
  }

  $("#save-settings").addEventListener("click", async () => {
    setStatus(els.adminStatus, "Saving event settings…");
    try {
      const selectedDate = $("#admin-date").value || null;
      const result = await adminRequest("settings", {
        signupsOpen: $("#admin-signups").checked,
        votingOpen: false,
        selectedDate,
      });
      setStatus(els.adminStatus, "Event settings saved.");
      renderPublic(result);
    } catch (error) { setStatus(els.adminStatus, error.message, true); }
  });

  $("#start-draw").addEventListener("click", async () => {
    if (!window.confirm("Close signups and make the Secret Santa draw? This draw cannot be undone.")) return;
    setStatus(els.adminStatus, "Closing signups and drawing names…");
    try {
      // Close signups before making the one-time draw.
      await adminRequest("settings", {
        signupsOpen: false,
        votingOpen: false,
        selectedDate: $("#admin-date").value || null,
      });
      const result = await adminRequest("draw");
      setStatus(els.adminStatus, `Draw complete for ${result.participants.length} classmates. Each person has one private reveal.`);
      renderPublic(result);
      toast("The draw is ready.");
    } catch (error) { setStatus(els.adminStatus, error.message, true); }
  });

  // A short original bell phrase—no autoplay and no third-party music tracking.
  let audioContext;
  let musicTimer;
  let noteIndex = 0;
  const notes = [659.25, 783.99, 987.77, 783.99, 698.46, 880, 1046.5, 880];
  const musicButton = $("#music-toggle");
  musicButton.addEventListener("click", async () => {
    if (musicTimer) {
      clearInterval(musicTimer); musicTimer = null;
      musicButton.setAttribute("aria-pressed", "false");
      $("#music-label").textContent = "Play a little tune";
      return;
    }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { window.open("https://open.spotify.com/search/christmas%20classics", "_blank", "noopener,noreferrer"); return; }
    audioContext ||= new Audio();
    await audioContext.resume();
    musicButton.setAttribute("aria-pressed", "true");
    $("#music-label").textContent = "Pause the tune";
    const playBell = () => {
      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "sine"; osc.frequency.value = notes[noteIndex++ % notes.length];
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.09, now + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, now + 1.05);
      osc.connect(gain); gain.connect(audioContext.destination); osc.start(now); osc.stop(now + 1.08);
    };
    playBell(); musicTimer = setInterval(playBell, 760);
  });

  refresh();
  window.setInterval(() => { if (API_URL) refresh(); }, 30000);
})();
