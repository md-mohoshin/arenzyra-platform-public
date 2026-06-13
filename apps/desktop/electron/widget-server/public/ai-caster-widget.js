(function () {
  const bootstrap = window.__ARENZYRA_AI_CASTER_BOOTSTRAP__ || {};
  const root = document.getElementById("ai-caster-root");
  const line = document.getElementById("ai-caster-line");
  const meta = document.getElementById("ai-caster-meta");
  const voice = document.getElementById("ai-caster-voice");
  const style = document.getElementById("ai-caster-style");

  if (!root || !line || !meta || !voice || !style) {
    return;
  }

  function setText(element, value) {
    element.textContent = String(value || "").trim() || "--";
  }

  function applyState(state) {
    const currentLine = state && state.currentLine ? state.currentLine : null;
    root.dataset.status = state && state.ok ? state.status || "live" : "locked";
    setText(meta, state && state.ok ? state.status || "Live" : "Locked");
    setText(line, currentLine ? currentLine.text : "AI Caster is standing by.");
    setText(voice, currentLine ? currentLine.voice : "system");
    setText(style, currentLine ? currentLine.style : "control");
  }

  async function refresh() {
    try {
      const query = new URLSearchParams(window.location.search);
      const response = await window.fetch(`/obs/ai-caster/state?${query.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`State request failed: ${response.status}`);
      }
      applyState(await response.json());
    } catch (_) {
      root.dataset.status = "error";
      setText(meta, "Error");
      setText(line, "AI Caster state unavailable.");
      setText(voice, "system");
      setText(style, "error");
    }
  }

  applyState(bootstrap.state || null);
  window.setInterval(refresh, 1500);
})();
