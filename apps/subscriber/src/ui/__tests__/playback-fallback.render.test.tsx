import { render, fireEvent } from '@testing-library/react-native';
import {
  PlaybackFallback,
  resolveLiveFallbackButtons,
  resolvePlaybackFallbackMessage,
  resolveVodFallbackButtons,
} from '../playback-fallback';

/**
 * `<PlaybackFallback>` 렌더 테스트 — T-W2-26.
 *
 * playback-fallback.test.ts는 `resolveLiveFallbackButtons`/`resolveVodFallbackButtons`
 * "순수 함수"만 테스트하고, 실제 컴포넌트 렌더 트리는 범위 밖이었다(jest.config.js의
 * testMatch가 app/을 배제해 화면 렌더 커버리지가 구조적으로 0%였던 문제의 연장 — 이 컴포넌트는
 * src/ui/에 있어 app/ 배제 대상은 아니지만, "resolve* 함수가 옳은 값을 반환한다"와 "그 값이
 * 실제로 그 버튼만 화면에 그려진다"는 서로 다른 명제다. 화면(app/live/[id].tsx·app/watch/[id].tsx)이
 * resolve* 결과를 곧이곧대로 넘기지 않고 하드코딩된 버튼을 섞어 렌더해도, 순수 함수 테스트만으로는
 * 못 잡는다).
 *
 * 여기서 고정하는 불변식: env 미설정(유튜브·전화 링크 둘 다 없음) 기본 배포에서
 * **"다시 시도" 버튼 1개만** 렌더되고, 설정되지 않은 버튼("유튜브에서 보기"·"전화로 문의하기")은
 * 아예 렌더되지 않는다(흐린 채로도 존재하지 않는다 — qa-verifier 실측 결함: 예전엔 두 버튼이
 * 전부 `disabled`인 죽은 화면이었다).
 */
describe('PlaybackFallback — env 미설정 기본 배포: "다시 시도" 1개만 렌더', () => {
  it('라이브 폴백: 유튜브·전화 둘 다 미설정이면 버튼이 "다시 시도" 1개뿐이다', async () => {
    const actions = resolveLiveFallbackButtons({ youtubeUrl: null, supportTelHref: null }).map(
      (b) => ({ label: b.label, onPress: jest.fn() }),
    );
    const message = resolvePlaybackFallbackMessage(actions.length);
    const { getByText, queryByText } = await render(
      <PlaybackFallback message={message} actions={actions} />,
    );

    expect(getByText('다시 시도')).toBeTruthy();
    // 설정 안 된 버튼은 흐린 채로도 존재하지 않는다 — 렌더 트리에서 아예 빠져야 한다
    expect(queryByText('유튜브에서 보기')).toBeNull();
    expect(queryByText('전화로 문의하기')).toBeNull();
  });

  it('VOD 폴백: 전화 미설정이면 버튼이 "다시 시도" 1개뿐이다', async () => {
    const actions = resolveVodFallbackButtons({ supportTelHref: null }).map((b) => ({
      label: b.label,
      onPress: jest.fn(),
    }));
    const message = resolvePlaybackFallbackMessage(actions.length);
    const { getByText, queryByText } = await render(
      <PlaybackFallback message={message} actions={actions} />,
    );

    expect(getByText('다시 시도')).toBeTruthy();
    expect(queryByText('전화로 문의하기')).toBeNull();
    // 버튼 1개 문구("아래 버튼을 눌러 다시 시도해 주세요")가 그대로 렌더된다 — 화면이 말하는 것과
    // 할 수 있는 것이 어긋나지 않는다(resolvePlaybackFallbackMessage 계약)
    expect(getByText(message)).toBeTruthy();
  });

  it('"다시 시도" 버튼을 누르면 해당 action의 onPress가 호출된다', async () => {
    const retry = jest.fn();
    const actions = [{ label: '다시 시도', onPress: retry }];
    const { getByText } = await render(
      <PlaybackFallback message={resolvePlaybackFallbackMessage(1)} actions={actions} />,
    );

    await fireEvent.press(getByText('다시 시도'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('PlaybackFallback — env 설정 시 추가 버튼도 실제로 렌더된다', () => {
  it('유튜브·전화 둘 다 설정되면 3개 버튼이 전부 렌더된다', async () => {
    const actions = resolveLiveFallbackButtons({
      youtubeUrl: 'https://youtube.com/live/abc',
      supportTelHref: 'tel:1670-0000',
    }).map((b) => ({ label: b.label, onPress: jest.fn() }));
    const { getByText } = await render(
      <PlaybackFallback message={resolvePlaybackFallbackMessage(actions.length)} actions={actions} />,
    );

    expect(getByText('다시 시도')).toBeTruthy();
    expect(getByText('유튜브에서 보기')).toBeTruthy();
    expect(getByText('전화로 문의하기')).toBeTruthy();
  });
});
