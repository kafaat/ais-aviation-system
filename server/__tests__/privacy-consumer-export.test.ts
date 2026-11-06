import { describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { privacyDocument } from "../services/privacy-export.service";

describe("privacy export of flight consumer records", () => {
  it("pages every owned save and helpful vote without exporting another user's records", async () => {
    const fixture = transactionMemory({
      users: [
        { id: 11, name: "Owner" },
        { id: 12, name: "Other" },
      ],
      user_flight_favorites: Array.from({ length: 61 }, (_, index) => ({
        id: index + 1,
        userId: index === 60 ? 12 : 11,
        flightId: index + 80,
      })),
      flight_review_helpful_votes: Array.from({ length: 61 }, (_, index) => ({
        id: index + 1,
        userId: index === 60 ? 12 : 11,
        reviewId: index + 90,
        createdAt: new Date("2026-11-05T08:00:00Z"),
      })),
    });
    let json = "";
    for await (const chunk of privacyDocument(fixture.db, 11, "json"))
      json += chunk;
    const document = JSON.parse(json);
    expect(document.individualFlightFavorites).toHaveLength(60);
    expect(document.reviewHelpfulVotes).toHaveLength(60);
    expect(
      document.individualFlightFavorites.every(
        (row: { userId: number }) => row.userId === 11
      )
    ).toBe(true);
    expect(
      document.reviewHelpfulVotes.every(
        (row: { userId: number }) => row.userId === 11
      )
    ).toBe(true);
    expect(document.reviewHelpfulVotes[59]).toMatchObject({
      id: 60,
      reviewId: 149,
    });
  });
});
