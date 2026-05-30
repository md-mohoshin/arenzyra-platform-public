(function () {
  const config = {
    eyebrow: "Tournament Feed",
    tournamentName: "Arenzyra Summer Invitational 2026",
    rotateEveryMs: 3200,
    logos: [
      {
        name: "Arenzyra Broadcast",
        src: "../assets/channel-logo.svg",
      },
      {
        name: "Aurora Energy",
        src: "../assets/sponsor-aurora.svg",
      },
      {
        name: "Skygrid Mobile",
        src: "../assets/sponsor-skygrid.svg",
      },
    ],
  };

  const eyebrow = document.getElementById("lowerThirdEyebrow");
  const title = document.getElementById("lowerThirdTitle");
  const logoShell = document.getElementById("logoShell");
  const logoImage = document.getElementById("brandLogo");
  const logoName = document.getElementById("brandName");

  if (!eyebrow || !title || !logoShell || !logoImage || !logoName) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const titleParam = params.get("title");
  const eyebrowParam = params.get("eyebrow");
  const rotationParam = Number.parseInt(params.get("rotate") || "", 10);

  if (titleParam) {
    config.tournamentName = titleParam;
  }
  if (eyebrowParam) {
    config.eyebrow = eyebrowParam;
  }
  if (Number.isFinite(rotationParam) && rotationParam > 0) {
    config.rotateEveryMs = rotationParam;
  }

  eyebrow.textContent = config.eyebrow;
  title.textContent = config.tournamentName;

  let activeIndex = 0;

  function renderLogo(index) {
    const item = config.logos[index];
    if (!item) {
      return;
    }

    logoImage.src = item.src;
    logoImage.alt = item.name;
    logoName.textContent = item.name;
  }

  function cycleLogo() {
    if (config.logos.length < 2) {
      return;
    }

    logoShell.classList.add("is-switching");

    window.setTimeout(function () {
      activeIndex = (activeIndex + 1) % config.logos.length;
      renderLogo(activeIndex);
      logoShell.classList.remove("is-switching");
    }, 220);
  }

  renderLogo(activeIndex);

  if (config.logos.length > 1) {
    window.setInterval(cycleLogo, config.rotateEveryMs);
  }
})();
