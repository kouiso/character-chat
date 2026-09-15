import { describe, expect, it } from "vitest";

import { resolveParticipantRoles } from "./participant-roles";

describe("resolveParticipantRoles", () => {
  it("userGender=male + characterGender=female → user insertive, character receptive", () => {
    expect(resolveParticipantRoles({ userGender: "male", characterGender: "female" })).toEqual({
      userRole: "insertive",
      characterRole: "receptive",
    });
  });

  it("userGender=female + characterGender=male → user receptive, character insertive", () => {
    expect(resolveParticipantRoles({ userGender: "female", characterGender: "male" })).toEqual({
      userRole: "receptive",
      characterRole: "insertive",
    });
  });

  it("same-sex combinations return null roles", () => {
    expect(resolveParticipantRoles({ userGender: "male", characterGender: "male" })).toEqual({
      userRole: null,
      characterRole: null,
    });
    expect(resolveParticipantRoles({ userGender: "female", characterGender: "female" })).toEqual({
      userRole: null,
      characterRole: null,
    });
  });

  it("'other' gender returns null roles", () => {
    expect(resolveParticipantRoles({ userGender: "other", characterGender: "female" })).toEqual({
      userRole: null,
      characterRole: null,
    });
    expect(resolveParticipantRoles({ userGender: "male", characterGender: "other" })).toEqual({
      userRole: null,
      characterRole: null,
    });
    expect(resolveParticipantRoles({ userGender: "other", characterGender: "other" })).toEqual({
      userRole: null,
      characterRole: null,
    });
  });

  it("explicit userRole/characterRole override gender defaults", () => {
    expect(
      resolveParticipantRoles({
        userGender: "male",
        characterGender: "female",
        userRole: "receptive",
        characterRole: "insertive",
      }),
    ).toEqual({
      userRole: "receptive",
      characterRole: "insertive",
    });
  });

  it("partial explicit role is completed with the opposite", () => {
    expect(
      resolveParticipantRoles({
        userGender: "male",
        characterGender: "male",
        userRole: "insertive",
      }),
    ).toEqual({
      userRole: "insertive",
      characterRole: "receptive",
    });
    expect(
      resolveParticipantRoles({
        userGender: "male",
        characterGender: "male",
        characterRole: "insertive",
      }),
    ).toEqual({
      userRole: "receptive",
      characterRole: "insertive",
    });
  });

  it("ignores invalid string values and falls back to gender defaults", () => {
    expect(
      resolveParticipantRoles({
        userGender: "male",
        characterGender: "female",
        userRole: "invalid" as unknown as string,
        characterRole: "also-invalid" as unknown as string,
      }),
    ).toEqual({
      userRole: "insertive",
      characterRole: "receptive",
    });
  });

  it("missing/null genders with no explicit roles return null", () => {
    expect(resolveParticipantRoles({})).toEqual({
      userRole: null,
      characterRole: null,
    });
    expect(resolveParticipantRoles({ userGender: null, characterGender: null })).toEqual({
      userRole: null,
      characterRole: null,
    });
  });
});
