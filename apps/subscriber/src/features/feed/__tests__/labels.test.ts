import { ProgramCategory } from '@gachinol/shared';
import { CATEGORY_LABEL, CULTURE_TOPIC_LABEL } from '../labels';

describe('labels', () => {
  test('CATEGORY_LABEL — 6종 전수 매핑 + snake_case 키', () => {
    for (const value of Object.values(ProgramCategory)) {
      expect(CATEGORY_LABEL[value]).toBeTruthy();
    }
    expect(CATEGORY_LABEL.local_weather).toBe('지역 날씨');
  });

  test('CULTURE_TOPIC_LABEL — 대표 키 확인', () => {
    expect(CULTURE_TOPIC_LABEL.food).toBe('먹거리');
    expect(CULTURE_TOPIC_LABEL.producer).toBe('생산자');
  });
});
