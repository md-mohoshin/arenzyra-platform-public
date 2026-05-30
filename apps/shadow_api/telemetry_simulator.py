from __future__ import annotations

import os
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass
class PlayerState:
    external_id: str
    name: str
    team_id: str
    team_name: str
    team_tag: str
    slot: int
    kills: int = 0
    alive: bool = True
    knocked: bool = False

    def to_shadow_player(self) -> dict[str, Any]:
        return {
            "playerExternalId": self.external_id,
            "playerOpenId": self.external_id,
            "playerId": self.external_id,
            "playerName": self.name,
            "teamId": self.team_id,
            "teamName": self.team_name,
            "teamTag": self.team_tag,
            "slot": self.slot,
            "kills": self.kills,
            "alive": self.alive,
            "knocked": self.knocked,
            "isAlive": self.alive,
            "isKnocked": self.knocked,
            "liveState": 1 if self.alive else 0,
            "status": "Knocked" if self.knocked else ("Alive" if self.alive else "Dead"),
        }


@dataclass
class TeamState:
    team_id: str
    name: str
    tag: str
    slot: int
    players: list[PlayerState] = field(default_factory=list)
    placement: int | None = None

    @property
    def alive_players(self) -> int:
        return sum(1 for player in self.players if player.alive)

    @property
    def total_players(self) -> int:
        return len(self.players)

    @property
    def kills(self) -> int:
        return sum(player.kills for player in self.players)

    @property
    def alive(self) -> bool:
        return self.alive_players > 0

    def to_shadow_team(self) -> dict[str, Any]:
        return {
            "teamId": self.team_id,
            "teamName": self.name,
            "name": self.name,
            "tag": self.tag,
            "teamTag": self.tag,
            "slot": self.slot,
            "kills": self.kills,
            "alivePlayers": self.alive_players,
            "totalPlayers": self.total_players,
            "placement": self.placement,
            "alive": self.alive,
            "players": [player.to_shadow_player() for player in self.players],
        }


class TelemetrySimulator:
    def __init__(self) -> None:
        self.enabled = _env_flag("SHADOW_SIMULATOR", False)
        self.team_count = max(2, _env_int("DEV_TELEMETRY_SIM_TEAMS", 16))
        self.players_per_team = max(1, _env_int("DEV_TELEMETRY_SIM_PLAYERS", 4))
        self.tick_interval_sec = max(0.5, _env_float("DEV_TELEMETRY_SIM_TICK_SEC", 2.0))
        self.reset_after_sec = max(5.0, _env_float("DEV_TELEMETRY_SIM_RESET_SEC", 12.0))
        self.seed = _env_int("DEV_TELEMETRY_SIM_SEED", 1337)
        self.random = random.Random(self.seed)
        self.lock = threading.Lock()
        self.match_number = 0
        self.event_number = 0
        self.started_at = time.time()
        self.last_tick_at = time.monotonic()
        self.ended_at: float | None = None
        self.circle_phase = 1
        self.safe_zone = {"x": 0.50, "y": 0.50, "r": 1.00}
        self.next_zone = {"x": 0.50, "y": 0.50, "r": 0.85}
        self.teams: list[TeamState] = []
        self.kill_events: list[dict[str, Any]] = []
        self.observed_player_id: str | None = None
        self.weapons = ["M416", "AKM", "UMP45", "SCAR-L", "Mini14", "M24"]
        self._reset_match(log_start=False)

    def snapshot_bundle(self) -> tuple[int, dict[str, Any]]:
        with self.lock:
            self._advance()
            return self._build_bundle()

    def _advance(self) -> None:
        now = time.monotonic()

        if self.ended_at is not None and now - self.ended_at >= self.reset_after_sec:
            self._reset_match()
            now = time.monotonic()

        while now - self.last_tick_at >= self.tick_interval_sec:
            self.last_tick_at += self.tick_interval_sec
            if self.ended_at is None:
                self._simulate_tick()

        self._update_observer()

    def _reset_match(self, log_start: bool = True) -> None:
        self.match_number += 1
        self.event_number = 0
        self.started_at = time.time()
        self.last_tick_at = time.monotonic()
        self.ended_at = None
        self.circle_phase = 1
        self.safe_zone = {"x": 0.50, "y": 0.50, "r": 1.00}
        self.next_zone = {"x": 0.50, "y": 0.50, "r": 0.85}
        self.kill_events = []
        self.teams = []

        for team_index in range(self.team_count):
            team_id = f"team_{team_index + 1}"
            slot = team_index + 1
            team = TeamState(
                team_id=team_id,
                name=f"Team {slot:02d}",
                tag=f"T{slot:02d}",
                slot=slot,
            )
            for player_index in range(self.players_per_team):
                player_slot = player_index + 1
                team.players.append(
                    PlayerState(
                        external_id=f"player_{slot}_{player_slot}",
                        name=f"Player {slot:02d}-{player_slot}",
                        team_id=team_id,
                        team_name=team.name,
                        team_tag=team.tag,
                        slot=slot,
                    )
                )
            self.teams.append(team)

        self.observed_player_id = self.teams[0].players[0].external_id
        if log_start:
            print(
                f"[TelemetrySimulator] match reset #{self.match_number} teams={self.team_count}",
                flush=True,
            )

    def _simulate_tick(self) -> None:
        self._advance_circle()

        if self._alive_team_count() <= 1:
            self._finalize_match()
            return

        action_roll = self.random.random()
        if self._knocked_players() and action_roll < 0.30:
            self._simulate_revive()
        elif self._knocked_players() and action_roll < 0.70:
            self._simulate_kill(from_knocked=True)
        elif action_roll < 0.88:
            self._simulate_knock()
        else:
            self._simulate_kill(from_knocked=False)

        if self._alive_team_count() <= 1:
            self._finalize_match()

    def _simulate_knock(self) -> None:
        pairing = self._pick_combat_pair(include_knocked_victims=False)
        if not pairing:
            return

        killer, victim = pairing
        victim.knocked = True
        self.observed_player_id = killer.external_id
        print(
            f"[TelemetrySimulator] knock {killer.external_id} -> {victim.external_id}",
            flush=True,
        )

    def _simulate_revive(self) -> None:
        knocked = self._knocked_players()
        if not knocked:
            return

        player = self.random.choice(knocked)
        player.knocked = False
        self.observed_player_id = player.external_id
        print(f"[TelemetrySimulator] revive {player.external_id}", flush=True)

    def _simulate_kill(self, from_knocked: bool) -> None:
        if from_knocked:
            victims = self._knocked_players()
            if not victims:
                return
            victim = self.random.choice(victims)
            killer = self._pick_killer_for_team(victim.team_id)
            if killer is None:
                return
        else:
            pairing = self._pick_combat_pair(include_knocked_victims=False)
            if not pairing:
                return
            killer, victim = pairing

        if not victim.alive:
            return

        victim.alive = False
        victim.knocked = False
        killer.kills += 1
        self.event_number += 1
        timestamp = int(time.time() * 1000)
        event = {
            "killId": f"kill_{self.match_number}_{self.event_number}",
            "killerId": killer.external_id,
            "killerPlayerId": killer.external_id,
            "killerPlayerExternalId": killer.external_id,
            "killerTeamId": killer.team_id,
            "killerName": killer.name,
            "victimId": victim.external_id,
            "victimPlayerId": victim.external_id,
            "victimPlayerExternalId": victim.external_id,
            "victimTeamId": victim.team_id,
            "victimName": victim.name,
            "weapon": self.random.choice(self.weapons),
            "timestamp": timestamp,
        }
        self.kill_events.append(event)
        self.observed_player_id = killer.external_id
        print(
            f"[TelemetrySimulator] kill {killer.external_id} -> {victim.external_id}",
            flush=True,
        )

        victim_team = self._team_by_id(victim.team_id)
        if victim_team and victim_team.alive_players == 0 and victim_team.placement is None:
            victim_team.placement = self._alive_team_count() + 1
            print(
                f"[TelemetrySimulator] team eliminated {victim_team.team_id}",
                flush=True,
            )

    def _pick_combat_pair(
        self,
        include_knocked_victims: bool,
    ) -> tuple[PlayerState, PlayerState] | None:
        alive_teams = [team for team in self.teams if team.alive_players > 0]
        if len(alive_teams) < 2:
            return None

        killer_team = self.random.choice(alive_teams)
        victim_team_candidates = [
            team for team in alive_teams if team.team_id != killer_team.team_id
        ]
        if not victim_team_candidates:
            return None

        victim_team = self.random.choice(victim_team_candidates)
        killers = [player for player in killer_team.players if player.alive]
        victims = [
            player
            for player in victim_team.players
            if player.alive and (include_knocked_victims or not player.knocked)
        ]

        if not killers or not victims:
            return None
        return self.random.choice(killers), self.random.choice(victims)

    def _pick_killer_for_team(self, excluded_team_id: str) -> PlayerState | None:
        candidates = [
            player
            for team in self.teams
            if team.team_id != excluded_team_id
            for player in team.players
            if player.alive
        ]
        if not candidates:
            return None
        return self.random.choice(candidates)

    def _knocked_players(self) -> list[PlayerState]:
        return [
            player
            for team in self.teams
            for player in team.players
            if player.alive and player.knocked
        ]

    def _alive_team_count(self) -> int:
        return sum(1 for team in self.teams if team.alive_players > 0)

    def _finalize_match(self) -> None:
        if self.ended_at is not None:
            return

        winners = [team for team in self.teams if team.alive_players > 0]
        if winners:
            winners[0].placement = 1
        self.ended_at = time.monotonic()

    def _advance_circle(self) -> None:
        if self.circle_phase >= 8:
            return

        if self.random.random() < 0.45:
            self.circle_phase += 1
            self.safe_zone = self.next_zone
            shrink = max(0.12, self.safe_zone["r"] * 0.78)
            self.next_zone = {
                "x": round(min(0.90, max(0.10, self.safe_zone["x"] + self.random.uniform(-0.12, 0.12))), 3),
                "y": round(min(0.90, max(0.10, self.safe_zone["y"] + self.random.uniform(-0.12, 0.12))), 3),
                "r": round(shrink, 3),
            }

    def _update_observer(self) -> None:
        observed = self._player_by_id(self.observed_player_id)
        if observed and observed.alive:
            return

        alive_players = [
            player
            for team in self.teams
            for player in team.players
            if player.alive
        ]
        self.observed_player_id = (
            self.random.choice(alive_players).external_id if alive_players else None
        )

    def _player_by_id(self, player_id: str | None) -> PlayerState | None:
        if not player_id:
            return None
        for team in self.teams:
            for player in team.players:
                if player.external_id == player_id:
                    return player
        return None

    def _team_by_id(self, team_id: str | None) -> TeamState | None:
        if not team_id:
            return None
        for team in self.teams:
            if team.team_id == team_id:
                return team
        return None

    def _build_bundle(self) -> tuple[int, dict[str, Any]]:
        ts = int(time.time())
        teams = [team.to_shadow_team() for team in self.teams]
        players = [player.to_shadow_player() for team in self.teams for player in team.players]
        observing = self._observing_player_payload()
        circle = {
            "phase": self.circle_phase,
            "safeZone": dict(self.safe_zone),
            "nextZone": dict(self.next_zone),
            "nextShrinkAt": int(time.time()) + 30,
        }
        kill_info = {
            "events": list(self.kill_events),
            "KillList": list(self.kill_events),
            "killList": list(self.kill_events),
            "kills": list(self.kill_events),
        }
        team_info_list = {"teamInfoList": teams, "TeamInfoList": teams}
        total_player_list = {
            "playerInfoList": players,
            "TotalPlayerList": players,
            "players": players,
        }
        team_backpack = {
            "TeamBackpackInfo": [
                {
                    "teamId": team.team_id,
                    "items": [
                        {"name": "FirstAid", "count": max(0, 3 - team.slot % 2)},
                        {"name": "Smoke", "count": 2 + (team.slot % 3)},
                    ],
                }
                for team in self.teams
            ]
        }
        all_info = {
            "MatchId": f"sim_match_{self.match_number}",
            "MatchPhase": "ENDED" if self.ended_at is not None else "LIVE",
            "TeamInfoList": teams,
            "TotalPlayerList": players,
            "KillInfo": kill_info,
            "CircleInfo": circle,
            "ObservingPlayer": observing,
            "TeamBackpackInfo": team_backpack["TeamBackpackInfo"],
        }

        bundle = {
            "/totalmessage": all_info,
            "/getallinfo": all_info,
            "/getteaminfo": teams,
            "/getteaminfolist": team_info_list,
            "/gettotalplayerlist": total_player_list,
            "/getkillinfo": kill_info,
            "/getcircleinfo": circle,
            "/getteambackpackinfo": team_backpack,
            "/getobservingplayer": observing,
        }
        return ts, bundle

    def _observing_player_payload(self) -> dict[str, Any]:
        player = self._player_by_id(self.observed_player_id)
        if player is None:
            return {}

        return {
            "playerId": player.external_id,
            "playerExternalId": player.external_id,
            "playerName": player.name,
            "teamId": player.team_id,
            "teamName": player.team_name,
            "teamTag": player.team_tag,
        }
