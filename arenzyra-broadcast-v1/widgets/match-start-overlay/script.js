(function () {
  const config = {
    title: "Arenzyra Summer Invitational 2026",
    eyebrow: "Official Broadcast",
    subtitle: "Stage Alpha | Live in 3... 2... 1...",
    status: "Match Start",
    hideAfterMs: 10000,
  };

  const root = document.getElementById("matchStart");
  const title = document.getElementById("matchTitle");
  const eyebrow = document.getElementById("matchEyebrow");
  const subtitle = document.getElementById("matchSubtitle");
  const status = document.getElementById("matchStatus");

  if (!root || !title || !eyebrow || !subtitle || !status) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const titleParam = params.get("title");
  const subtitleParam = params.get("subtitle");
  const eyebrowParam = params.get("eyebrow");
  const statusParam = params.get("status");
  const durationParam = Number.parseInt(params.get("duration") || "", 10);
  const shouldAutoHide = params.get("autohide") !== "0";

  if (titleParam) {
    config.title = titleParam;
  }
  if (subtitleParam) {
    config.subtitle = subtitleParam;
  }
  if (eyebrowParam) {
    config.eyebrow = eyebrowParam;
  }
  if (statusParam) {
    config.status = statusParam;
  }
  if (Number.isFinite(durationParam) && durationParam > 0) {
    config.hideAfterMs = durationParam;
  }

  title.textContent = config.title;
  eyebrow.textContent = config.eyebrow;
  subtitle.textContent = config.subtitle;
  status.textContent = config.status.toUpperCase();

  window.requestAnimationFrame(function () {
    root.dataset.state = "visible";
  });

  if (!shouldAutoHide) {
    return;
  }

  window.setTimeout(function () {
    root.dataset.state = "hidden";

    window.setTimeout(function () {
      root.style.display = "none";
    }, 900);
  }, config.hideAfterMs);
})();
