import {
  deriveSelfUrl,
  escapeHtml,
  GoLinkService,
  GO_LINK_BASE_URL_ENV_KEY,
  GO_LINK_CACHE_TTL_ENV_KEY,
  GO_LINK_STALE_TTL_ENV_KEY,
  normalizeBaseUrl,
  renderNotFoundPage,
  renderSharePage,
  toJsStringLiteral,
  truncateText,
  WEB_WATCH_BASE_URL_ENV_KEY,
} from './go-link.service';

const CONTENT_ID = '01920000-0000-7000-8000-0000000000a1';
const GO_BASE = 'https://go.example.test';
const WATCH_BASE = 'https://watch.example.test';
const SHORT_URL = `${GO_BASE}/c/${CONTENT_ID}`;
const WATCH_URL = `${WATCH_BASE}/watch/${CONTENT_ID}`;

const contentRow = (over: Record<string, unknown> = {}) => ({
  id: CONTENT_ID,
  status: 'published',
  generation: 1,
  title: '애월 앞바다 물때 이야기',
  description: null,
  publishedAt: new Date('2026-07-20T09:00:00.000Z'),
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  station: { name: '애월 마을방송국' },
  ...over,
});

const makeService = (env: Record<string, unknown> = {}) => {
  const prisma = {
    content: { findUnique: jest.fn() },
    mediaAsset: { findFirst: jest.fn() },
    aiAnalysis: { findFirst: jest.fn() },
  };
  const s3 = { presignGet: jest.fn() };
  const config = {
    get: jest.fn((key: string) => env[key]),
  };
  const service = new GoLinkService(prisma as never, s3 as never, config as never);
  return { service, prisma, s3, config, env };
};

/** 기본 배선: published 콘텐츠 1건 + ready 썸네일 1건 */
const wireHappyPath = (
  deps: ReturnType<typeof makeService>,
  over: Record<string, unknown> = {},
) => {
  deps.prisma.content.findUnique.mockResolvedValue(contentRow(over));
  deps.prisma.mediaAsset.findFirst.mockResolvedValue({ id: 'thumb-1', storageKey: 'k/thumb.jpg' });
  deps.prisma.aiAnalysis.findFirst.mockResolvedValue(null);
};

const CONFIGURED = {
  [GO_LINK_BASE_URL_ENV_KEY]: GO_BASE,
  [WEB_WATCH_BASE_URL_ENV_KEY]: WATCH_BASE,
};

describe('escapeHtml', () => {
  it('HTML 특수문자 5종을 전부 치환한다', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('제어문자는 공백으로 접는다 (속성값 줄바꿈으로 태그가 깨지는 것 방지)', () => {
    expect(escapeHtml('a\nb\tc')).toBe('a b c');
  });

  it('한글·이모지는 보존한다', () => {
    expect(escapeHtml('애월 🌊')).toBe('애월 🌊');
  });
});

describe('toJsStringLiteral', () => {
  it('`</script>`가 스크립트를 조기 종료하지 못한다', () => {
    expect(toJsStringLiteral('https://x/</script>')).not.toContain('</script>');
    expect(toJsStringLiteral('https://x/</script>')).toContain('\\u003c/script>');
  });
});

describe('normalizeBaseUrl', () => {
  it('후행 슬래시를 제거한다', () => {
    expect(normalizeBaseUrl('https://go.example.test/')).toBe('https://go.example.test');
  });

  it('경로가 있는 베이스도 보존한다', () => {
    expect(normalizeBaseUrl('https://example.test/go/')).toBe('https://example.test/go');
  });

  it.each([
    ['미설정', undefined],
    ['빈 문자열', '   '],
    ['상대 경로', '/go'],
    ['http/https 아님', 'ftp://go.example.test'],
    ['자격증명 포함', 'https://u:p@go.example.test'],
    ['쿼리 포함', 'https://go.example.test/?a=1'],
  ])('%s는 미설정과 동일하게 null', (_label, value) => {
    expect(normalizeBaseUrl(value)).toBeNull();
  });
});

describe('truncateText', () => {
  it('최대 길이 이하는 그대로', () => {
    expect(truncateText('짧은 제목', 10)).toBe('짧은 제목');
  });

  it('초과분은 말줄임으로 절삭한다', () => {
    expect(truncateText('가'.repeat(20), 5)).toBe(`${'가'.repeat(4)}…`);
  });

  it('연속 공백·개행을 한 칸으로 접는다', () => {
    expect(truncateText('  가   나\n다 ', 50)).toBe('가 나 다');
  });
});

describe('deriveSelfUrl', () => {
  const fallback = { protocol: 'http', host: 'api.internal:4000', path: '/v1/go/c/abc' };

  it('X-Forwarded-* 를 우선한다 (CF·nginx 뒤)', () => {
    expect(
      deriveSelfUrl(
        { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'go.example.test' },
        fallback,
      ),
    ).toBe('https://go.example.test/v1/go/c/abc');
  });

  it('콤마 목록·배열 헤더는 첫 값만 취한다', () => {
    expect(
      deriveSelfUrl(
        {
          'x-forwarded-proto': ['https', 'http'],
          'x-forwarded-host': 'go.example.test, evil.test',
        },
        fallback,
      ),
    ).toBe('https://go.example.test/v1/go/c/abc');
  });

  it('헤더가 없으면 요청 자신의 프로토콜·호스트를 쓴다', () => {
    expect(deriveSelfUrl({}, fallback)).toBe('http://api.internal:4000/v1/go/c/abc');
  });

  it('문자셋이 어긋난 주입 호스트는 폴백으로 되돌린다', () => {
    expect(deriveSelfUrl({ 'x-forwarded-host': 'evil.test/"><script>' }, fallback)).toBe(
      'http://api.internal:4000/v1/go/c/abc',
    );
  });
});

describe('renderSharePage', () => {
  const view = {
    title: '제목',
    description: '설명',
    siteName: '가치놀',
    shortUrl: SHORT_URL,
    directUrl: WATCH_URL,
    imageUrl: `${SHORT_URL}/thumb`,
    publishedAt: '2026-07-20T09:00:00.000Z',
  };

  it('OG 필수 메타를 head 최상단에 싣는다', () => {
    const html = renderSharePage(view);
    expect(html).toContain(`<meta property="og:title" content="제목">`);
    expect(html).toContain(`<meta property="og:description" content="설명">`);
    expect(html).toContain(`<meta property="og:url" content="${SHORT_URL}">`);
    expect(html).toContain(`<meta property="og:image" content="${SHORT_URL}/thumb">`);
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('<style>'));
  });

  it('사람용 리다이렉트 3중화 — meta refresh · script · 본문 앵커', () => {
    const html = renderSharePage(view);
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${WATCH_URL}">`);
    expect(html).toContain(`location.replace("${WATCH_URL}")`);
    expect(html).toContain(`<a class="go" href="${WATCH_URL}">`);
  });

  it('canonical은 go.가 아니라 watch. 직접 링크를 가리킨다', () => {
    expect(renderSharePage(view)).toContain(`<link rel="canonical" href="${WATCH_URL}">`);
  });

  it('썸네일이 없으면 og:image 생략 + twitter:card=summary', () => {
    const html = renderSharePage({ ...view, imageUrl: null });
    expect(html).not.toContain('og:image');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('목적지 미설정이면 리다이렉트·canonical 없이 안내만 렌더한다', () => {
    const html = renderSharePage({ ...view, directUrl: null });
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('location.replace');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('아직 설정되지 않았습니다');
  });
});

describe('renderNotFoundPage', () => {
  it('OG 메타 없이 noindex — 죽은 링크에 미리보기가 뜨면 안 된다', () => {
    const html = renderNotFoundPage(null);
    expect(html).not.toContain('og:');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('홈 주소가 있으면 복귀 링크를 준다', () => {
    expect(renderNotFoundPage(`${WATCH_BASE}/`)).toContain(`href="${WATCH_BASE}/"`);
  });
});

describe('GoLinkService.buildShareLinks (조치 2 — 직접 링크 병행 발급)', () => {
  it('단축 링크와 watch. 직접 링크를 함께 발급한다', () => {
    const { service } = makeService(CONFIGURED);
    expect(service.buildShareLinks(CONTENT_ID)).toEqual({
      shortUrl: SHORT_URL,
      directUrl: WATCH_URL,
    });
  });

  it('GO_LINK_BASE_URL 미설정이면 요청 자기 URL로 저하한다 (도메인 추측 금지)', () => {
    const { service } = makeService({ [WEB_WATCH_BASE_URL_ENV_KEY]: WATCH_BASE });
    const self = 'http://localhost:4000/v1/go/c/' + CONTENT_ID;
    expect(service.buildShareLinks(CONTENT_ID, self).shortUrl).toBe(self);
  });

  it('WEB_WATCH_BASE_URL 미설정이면 목적지를 추측하지 않고 null', () => {
    const { service } = makeService({ [GO_LINK_BASE_URL_ENV_KEY]: GO_BASE });
    expect(service.buildShareLinks(CONTENT_ID).directUrl).toBeNull();
  });
});

describe('GoLinkService.renderContentShare', () => {
  const ctx = { selfUrl: `http://localhost:4000/v1/go/c/${CONTENT_ID}` };

  it('published 콘텐츠는 200 OG HTML + 안정 썸네일 URL', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(out.body).toContain(`<meta property="og:title" content="애월 앞바다 물때 이야기">`);
    expect(out.body).toContain(`<meta property="og:url" content="${SHORT_URL}">`);
    // og:image는 만료되는 서명 URL이 아니라 `<short>/thumb` 안정 URL이어야 한다
    expect(out.body).toContain(`<meta property="og:image" content="${SHORT_URL}/thumb">`);
    expect(out.body).toContain(`location.replace("${WATCH_URL}")`);
  });

  it('OG HTML 조립 경로는 S3 서명을 호출하지 않는다 (S3 장애가 미리보기를 무너뜨리지 못한다)', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);
    await deps.service.renderContentShare(CONTENT_ID, ctx);
    expect(deps.s3.presignGet).not.toHaveBeenCalled();
  });

  it('가용성 조치 1 — 짧은 TTL + stale-if-error 캐시 지시자를 낸다', async () => {
    const deps = makeService({
      ...CONFIGURED,
      [GO_LINK_CACHE_TTL_ENV_KEY]: '120',
      [GO_LINK_STALE_TTL_ENV_KEY]: '3600',
    });
    wireHappyPath(deps);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.headers['Cache-Control']).toBe(
      'public, max-age=120, s-maxage=120, stale-while-revalidate=60, stale-if-error=3600',
    );
    expect(out.headers['CDN-Cache-Control']).toBe('public, max-age=120, stale-if-error=3600');
    // 단일 변형 설계 — UA로 캐시를 쪼개지 않는다(CF는 어차피 Vary: UA를 캐시 키에 반영하지 않는다)
    expect(out.headers['Vary']).toBeUndefined();
  });

  it('TTL env가 없으면 기본값(300s / 7일 stale)', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);
    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);
    expect(out.headers['Cache-Control']).toContain('max-age=300');
    expect(out.headers['Cache-Control']).toContain('stale-if-error=604800');
  });

  it('제목·설명의 HTML 특수문자를 이스케이프한다 (OG 페이지 XSS 차단)', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps, {
      title: '"><script>alert(1)</script>',
      description: '<img src=x onerror=alert(2)>',
    });

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.body).not.toContain('<script>alert(1)');
    expect(out.body).not.toContain('<img src=x');
    expect(out.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('썸네일이 없으면 og:image를 넣지 않는다', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);
    deps.prisma.mediaAsset.findFirst.mockResolvedValue(null);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.body).not.toContain('og:image');
  });

  it('설명 우선순위 ① 기자 기입', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps, { description: '  이번 주 물때 정리  ' });

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.body).toContain('content="이번 주 물때 정리"');
    expect(deps.prisma.aiAnalysis.findFirst).not.toHaveBeenCalled();
  });

  it('설명 우선순위 ② AI 요약(현 세대)', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps, { generation: 3 });
    deps.prisma.aiAnalysis.findFirst.mockResolvedValue({ text: { summary: 'AI 한 줄 요약' } });

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.body).toContain('content="AI 한 줄 요약"');
    expect(deps.prisma.aiAnalysis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contentId: CONTENT_ID, generation: 3 } }),
    );
  });

  it('설명 우선순위 ③ 지사 기반 기본 문구', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.body).toContain('애월 마을방송국에서 전하는 소식입니다.');
  });

  it('없는 콘텐츠는 404 HTML + 짧은 음성 캐시', async () => {
    const deps = makeService(CONFIGURED);
    deps.prisma.content.findUnique.mockResolvedValue(null);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.status).toBe(404);
    expect(out.headers['Cache-Control']).toBe('public, max-age=60');
    expect(out.body).toContain('콘텐츠를 찾을 수 없습니다');
    expect(out.body).not.toContain('og:');
  });

  it.each(['draft', 'awaiting_center_review', 'archived', 'rejected'])(
    '비published(%s)는 만료된 링크와 동일하게 404',
    async (status) => {
      const deps = makeService(CONFIGURED);
      wireHappyPath(deps, { status });

      const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

      expect(out.status).toBe(404);
      expect(out.body).not.toContain('og:title');
    },
  );

  it('형식이 어긋난 id는 DB를 건드리지 않고 404 (JSON 에러가 아니라 HTML)', async () => {
    const deps = makeService(CONFIGURED);

    const out = await deps.service.renderContentShare('not-a-uuid', ctx);

    expect(out.status).toBe(404);
    expect(out.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(deps.prisma.content.findUnique).not.toHaveBeenCalled();
  });

  it('WEB_WATCH_BASE_URL 미설정 — 미리보기는 살리되 no-store로 캐시를 막는다', async () => {
    const deps = makeService({ [GO_LINK_BASE_URL_ENV_KEY]: GO_BASE });
    wireHappyPath(deps);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.status).toBe(200);
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.body).toContain('og:title');
    expect(out.body).not.toContain('location.replace');
  });

  it('GO_LINK_BASE_URL 미설정 — og:url이 요청 자기 URL로 저하한다', async () => {
    const deps = makeService({ [WEB_WATCH_BASE_URL_ENV_KEY]: WATCH_BASE });
    wireHappyPath(deps);

    const out = await deps.service.renderContentShare(CONTENT_ID, ctx);

    expect(out.body).toContain(`<meta property="og:url" content="${ctx.selfUrl}">`);
    expect(out.body).toContain(`<meta property="og:image" content="${ctx.selfUrl}/thumb">`);
  });
});

describe('GoLinkService.resolveThumbnail', () => {
  it('서명 URL로 302한다 (og:image의 안정 URL)', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);
    deps.s3.presignGet.mockResolvedValue({ url: 'https://s3.test/thumb.jpg?sig=1' });

    const out = await deps.service.resolveThumbnail(CONTENT_ID);

    expect(out.status).toBe(302);
    expect(out.headers['Location']).toBe('https://s3.test/thumb.jpg?sig=1');
  });

  it('캐시 TTL은 서명 만료의 절반 이하로 묶는다 (만료된 목적지 캐시 금지)', async () => {
    const deps = makeService({ ...CONFIGURED, DOWNLOAD_URL_TTL_SEC: 120 });
    wireHappyPath(deps);
    deps.s3.presignGet.mockResolvedValue({ url: 'https://s3.test/t.jpg' });

    const out = await deps.service.resolveThumbnail(CONTENT_ID);

    expect(out.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=60');
    expect(out.headers['Cache-Control']).not.toContain('stale-if-error');
  });

  it('서명 만료가 아주 짧아도 최소 30초는 캐시한다', async () => {
    const deps = makeService({ ...CONFIGURED, DOWNLOAD_URL_TTL_SEC: 20 });
    wireHappyPath(deps);
    deps.s3.presignGet.mockResolvedValue({ url: 'https://s3.test/t.jpg' });

    expect((await deps.service.resolveThumbnail(CONTENT_ID)).headers['Cache-Control']).toBe(
      'public, max-age=30, s-maxage=30',
    );
  });

  it('비published 콘텐츠의 썸네일은 익명에게 흘리지 않는다', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps, { status: 'awaiting_reporter_review' });

    const out = await deps.service.resolveThumbnail(CONTENT_ID);

    expect(out.status).toBe(404);
    expect(deps.s3.presignGet).not.toHaveBeenCalled();
  });

  it('썸네일 자산이 없으면 404', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);
    deps.prisma.mediaAsset.findFirst.mockResolvedValue(null);

    expect((await deps.service.resolveThumbnail(CONTENT_ID)).status).toBe(404);
  });

  it('서명 실패(S3 자격 미설정 등)는 500이 아니라 404로 수렴한다', async () => {
    const deps = makeService(CONFIGURED);
    wireHappyPath(deps);
    deps.s3.presignGet.mockRejectedValue(new Error('S3 자격이 설정되지 않았습니다'));

    const out = await deps.service.resolveThumbnail(CONTENT_ID);

    expect(out.status).toBe(404);
  });

  it('형식이 어긋난 id는 DB·S3를 건드리지 않는다', async () => {
    const deps = makeService(CONFIGURED);

    const out = await deps.service.resolveThumbnail('nope');

    expect(out.status).toBe(404);
    expect(deps.prisma.content.findUnique).not.toHaveBeenCalled();
    expect(deps.s3.presignGet).not.toHaveBeenCalled();
  });
});
