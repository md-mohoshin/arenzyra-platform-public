import { BadRequestException } from '@nestjs/common';
import { buildQualificationSettingsData } from './qualification-settings.util';

describe('buildQualificationSettingsData', () => {
  it('normalizes present qualification settings', () => {
    expect(
      buildQualificationSettingsData({
        qualifiedTeamsCount: '16',
        qualificationBubbleCount: '2',
        qualificationLabel: ' TOP 16 QUALIFY ',
      }),
    ).toEqual({
      qualifiedTeamsCount: 16,
      qualificationBubbleCount: 2,
      qualificationLabel: 'TOP 16 QUALIFY',
    });
  });

  it('keeps omitted settings out of partial update data', () => {
    expect(buildQualificationSettingsData({})).toEqual({});
  });

  it('uses nulls to clear settings', () => {
    expect(
      buildQualificationSettingsData({
        qualifiedTeamsCount: null,
        qualificationBubbleCount: '',
        qualificationLabel: '',
      }),
    ).toEqual({
      qualifiedTeamsCount: null,
      qualificationBubbleCount: null,
      qualificationLabel: null,
    });
  });

  it('rejects invalid counts', () => {
    expect(() =>
      buildQualificationSettingsData({ qualifiedTeamsCount: 0 }),
    ).toThrow(BadRequestException);
  });
});
