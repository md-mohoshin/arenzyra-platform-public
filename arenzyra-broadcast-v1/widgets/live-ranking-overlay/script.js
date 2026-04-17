(function () {
  const rankingData = [
    { team: "Night Raiders", tag: "NRD", kills: 13, points: 28 },
    { team: "Quantum Tide", tag: "QTD", kills: 11, points: 24 },
    { team: "Echo Unit", tag: "ECH", kills: 9, points: 21 },
    { team: "Stormforge", tag: "SFG", kills: 8, points: 19 },
    { team: "Black Haven", tag: "BHV", kills: 7, points: 17 },
    { team: "Cobalt Wolves", tag: "CBW", kills: 6, points: 15 },
  ];

  const list = document.getElementById("rankingList");
  const teamCount = document.getElementById("rankingTeamCount");

  if (!list || !teamCount) {
    return;
  }

  function normalizeRows(rows) {
    return rows
      .slice()
      .sort(function (left, right) {
        if (right.points !== left.points) {
          return right.points - left.points;
        }
        if (right.kills !== left.kills) {
          return right.kills - left.kills;
        }
        return left.team.localeCompare(right.team);
      });
  }

  function render(rows) {
    const sortedRows = normalizeRows(rows);

    teamCount.textContent = String(sortedRows.length);
    list.innerHTML = sortedRows
      .map(function (row, index) {
        return [
          '<article class="ranking__row">',
          '  <div class="ranking__place">' + String(index + 1) + "</div>",
          '  <div class="ranking__team">',
          '    <span class="ranking__team-name">' + row.team + "</span>",
          '    <span class="ranking__team-tag">' + row.tag + "</span>",
          "  </div>",
          '  <div class="ranking__value">' + String(row.kills) + "</div>",
          '  <div class="ranking__value ranking__value--points">' + String(row.points) + "</div>",
          "</article>",
        ].join("");
      })
      .join("");
  }

  window.renderArenzyraRanking = function (rows) {
    if (!Array.isArray(rows)) {
      return;
    }

    render(
      rows.filter(function (row) {
        return row && typeof row.team === "string";
      }),
    );
  };

  render(rankingData);
})();
