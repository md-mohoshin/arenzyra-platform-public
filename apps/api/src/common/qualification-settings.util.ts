import { BadRequestException } from '@nestjs/common';

export type QualificationSettingsInput = {
  qualifiedTeamsCount?: number | string | null;
  qualificationBubbleCount?: number | string | null;
  qualificationLabel?: string | null;
};

export type QualificationSettingsData = {
  qualifiedTeamsCount?: number | null;
  qualificationBubbleCount?: number | null;
  qualificationLabel?: string | null;
};

function normalizeOptionalInteger(
  value: number | string | null | undefined,
  field: string,
  min: number,
  max: number,
) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(
      `${field} must be a whole number between ${min} and ${max}`,
    );
  }
  return parsed;
}

export function buildQualificationSettingsData(
  input: QualificationSettingsInput | null | undefined,
): QualificationSettingsData {
  if (!input) return {};

  const data: QualificationSettingsData = {};
  const qualifiedTeamsCount = normalizeOptionalInteger(
    input.qualifiedTeamsCount,
    'qualifiedTeamsCount',
    1,
    999,
  );
  const qualificationBubbleCount = normalizeOptionalInteger(
    input.qualificationBubbleCount,
    'qualificationBubbleCount',
    0,
    999,
  );

  if (qualifiedTeamsCount !== undefined) {
    data.qualifiedTeamsCount = qualifiedTeamsCount;
  }
  if (qualificationBubbleCount !== undefined) {
    data.qualificationBubbleCount = qualificationBubbleCount;
  }
  if (input.qualificationLabel !== undefined) {
    const label = input.qualificationLabel?.trim() ?? '';
    if (label.length > 80) {
      throw new BadRequestException(
        'qualificationLabel must be 80 characters or fewer',
      );
    }
    data.qualificationLabel = label || null;
  }

  return data;
}
