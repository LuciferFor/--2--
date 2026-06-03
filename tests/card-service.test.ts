import { describe, expect, it } from "vitest";
import { CardService } from "../src/cards/card-service.js";
import type {
  AccountSummary,
  PgcrSummary,
  PlayerSearchResult,
  ProfileSummary,
  WeaponsSummary
} from "../src/destiny/destiny-types.js";

describe("CardService", () => {
  it("renders a summary PNG", async () => {
    const service = new CardService();
    const player: PlayerSearchResult = {
      bungieName: "Guardian#0007",
      displayName: "Guardian",
      displayNameCode: 7,
      membershipType: 3,
      membershipId: "4611686018"
    };
    const summary: AccountSummary = {
      membershipType: 3,
      membershipId: "4611686018",
      mode: "raid",
      modeLabel: "突袭",
      updatedAt: "2026-06-03T00:00:00.000Z",
      stats: {
        activitiesEntered: 10,
        activitiesWon: 5,
        kills: 200,
        deaths: 40,
        assists: 60,
        secondsPlayed: 7200,
        kd: 5,
        kda: 5.75,
        efficiency: 6.5,
        winRate: 50
      }
    };

    const png = await service.renderSummaryCard(player, summary);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(1000);
  });

  it("renders an activity PNG", async () => {
    const service = new CardService();
    const pgcr: PgcrSummary = {
      activityId: "123",
      period: "2026-06-03T00:00:00.000Z",
      activityName: "玻璃宝库",
      mode: 4,
      modeName: "突袭",
      teams: [],
      players: [
        {
          displayName: "Guardian",
          kills: 20,
          deaths: 4,
          assists: 8,
          kd: 5,
          kda: 6,
          efficiency: 7,
          completed: true,
          score: 0,
          weapons: []
        }
      ]
    };

    const png = await service.renderActivityCard(pgcr);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(1000);
  });

  it("renders profile and weapons PNG cards", async () => {
    const service = new CardService();
    const player: PlayerSearchResult = {
      bungieName: "Guardian#0007",
      displayName: "Guardian",
      displayNameCode: 7,
      membershipType: 3,
      membershipId: "4611686018"
    };
    const profile: ProfileSummary = {
      membershipType: 3,
      membershipId: "4611686018",
      profile: {
        dateLastPlayed: "2026-06-03T00:00:00.000Z",
        minutesPlayedTotal: 240,
        characterIds: ["2305843009"]
      },
      characters: [
        {
          characterId: "2305843009",
          classType: 1,
          className: "猎人",
          light: 2010,
          dateLastPlayed: "2026-06-03T00:00:00.000Z",
          minutesPlayedTotal: 240
        }
      ]
    };
    const weapons: WeaponsSummary = {
      membershipType: 3,
      membershipId: "4611686018",
      updatedAt: "2026-06-03T00:00:00.000Z",
      weapons: [
        {
          referenceId: "99",
          name: "命运使者",
          kills: 100,
          precisionKills: 50,
          secondsUsed: 3600
        }
      ]
    };

    const profilePng = await service.renderProfileCard(player, profile);
    const weaponsPng = await service.renderWeaponsCard(player, weapons);
    expect(profilePng.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(weaponsPng.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(profilePng.length).toBeGreaterThan(1000);
    expect(weaponsPng.length).toBeGreaterThan(1000);
  });
});
