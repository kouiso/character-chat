export type ParticipantGender = "male" | "female" | "other";
export type ParticipantRole = "insertive" | "receptive" | null;

export interface InsertiveReceptiveRoles {
  userRole: ParticipantRole;
  characterRole: ParticipantRole;
}

export interface ResolveParticipantRolesInput {
  userGender?: ParticipantGender | string | null;
  characterGender?: ParticipantGender | string | null;
  userRole?: ParticipantRole | string | null;
  characterRole?: ParticipantRole | string | null;
}

const isParticipantGender = (value: unknown): value is ParticipantGender =>
  value === "male" || value === "female" || value === "other";

const normalizeGender = (value: unknown): ParticipantGender | null =>
  isParticipantGender(value) ? value : null;

const isParticipantRole = (value: unknown): value is ParticipantRole =>
  value === "insertive" || value === "receptive" || value === null;

const normalizeRole = (value: unknown): ParticipantRole => {
  if (value === undefined) return null;
  return isParticipantRole(value) ? value : null;
};

const oppositeRole = (role: NonNullable<ParticipantRole>): NonNullable<ParticipantRole> =>
  role === "insertive" ? "receptive" : "insertive";

const resolveExplicitRoles = (
  userRole: ParticipantRole,
  characterRole: ParticipantRole,
): InsertiveReceptiveRoles | null => {
  if (userRole && characterRole) {
    return { userRole, characterRole };
  }
  if (userRole) {
    return { userRole, characterRole: oppositeRole(userRole) };
  }
  if (characterRole) {
    return { userRole: oppositeRole(characterRole), characterRole };
  }
  return null;
};

const resolveGenderBasedRoles = (
  userGender: ParticipantGender | null,
  characterGender: ParticipantGender | null,
): InsertiveReceptiveRoles => {
  if (userGender === "male" && characterGender === "female") {
    return { userRole: "insertive", characterRole: "receptive" };
  }
  if (userGender === "female" && characterGender === "male") {
    return { userRole: "receptive", characterRole: "insertive" };
  }
  return { userRole: null, characterRole: null };
};

export const resolveParticipantRoles = (
  input: ResolveParticipantRolesInput,
): InsertiveReceptiveRoles => {
  const explicitUserRole = normalizeRole(input.userRole);
  const explicitCharacterRole = normalizeRole(input.characterRole);
  const explicit = resolveExplicitRoles(explicitUserRole, explicitCharacterRole);
  if (explicit) return explicit;

  const userGender = normalizeGender(input.userGender);
  const characterGender = normalizeGender(input.characterGender);
  return resolveGenderBasedRoles(userGender, characterGender);
};
