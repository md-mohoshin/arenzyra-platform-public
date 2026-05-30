(function () {
  const params = new URLSearchParams(window.location.search);
  const root = document.getElementById("mvpOverlay");
  const label = document.getElementById("label");
  const playerName = document.getElementById("playerName");
  const teamName = document.getElementById("teamName");
  const kills = document.getElementById("kills");
  const damage = document.getElementById("damage");
  const placement = document.getElementById("placement");
  const playerPhoto = document.getElementById("playerPhoto");
  const playerFallback = document.getElementById("playerFallback");
  const teamLogo = document.getElementById("teamLogo");

  if (!root || !label || !playerName || !teamName || !kills || !damage || !placement || !playerPhoto || !playerFallback || !teamLogo) {
    return;
  }

  const data = {
    label: params.get("label") || "MATCH MVP",
    player: params.get("player") || "RAVEN",
    team: params.get("team") || "Arenzyra Esports",
    kills: params.get("kills") || "12",
    damage: params.get("damage") || "1840",
    placement: params.get("placement") || "1",
    photo: params.get("photo") || "",
    logo: params.get("logo") || "../assets/tournament-logo.svg",
  };

  label.textContent = data.label;
  playerName.textContent = data.player;
  teamName.textContent = data.team;
  kills.textContent = data.kills;
  damage.textContent = data.damage;
  placement.textContent = data.placement.startsWith("#") ? data.placement : `#${data.placement}`;
  playerFallback.textContent = initials(data.player);
  teamLogo.src = data.logo;

  teamLogo.onerror = function () {
    teamLogo.src = "../assets/tournament-logo.svg";
  };

  if (data.photo) {
    playerPhoto.src = data.photo;
    playerPhoto.onload = function () {
      playerPhoto.style.display = "block";
      playerFallback.style.display = "none";
    };
    playerPhoto.onerror = function () {
      playerPhoto.style.display = "none";
      playerFallback.style.display = "grid";
    };
  }

  window.requestAnimationFrame(function () {
    root.dataset.state = "visible";
  });

  function initials(value) {
    const cleaned = String(value || "MVP").trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return cleaned.slice(0, 3).toUpperCase();
  }
})();
