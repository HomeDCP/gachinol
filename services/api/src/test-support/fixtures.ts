/** 단위 테스트 공용 픽스처·mock — DB 불요 (Prisma mock) */
import type { User } from '@gachinol/shared';
import type {
  ChannelAccount as ChannelAccountRow,
  Content as ContentRow,
  Publication as PublicationRow,
  Station as StationRow,
} from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

const NOW = new Date('2026-07-20T00:00:00.000Z');

export const reporterUser = (over: Partial<User> = {}): User =>
  ({
    id: 'u-reporter',
    role: 'reporter',
    stationId: 's-aewol',
    name: '애월 기자',
    status: 'active',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }) as User;

export const adminUser = (over: Partial<User> = {}): User =>
  ({
    id: 'u-admin',
    role: 'admin',
    name: '관리자',
    status: 'active',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }) as User;

export const centerOperatorUser = (over: Partial<User> = {}): User =>
  ({
    id: 'u-center',
    role: 'center_operator',
    stationId: 's-center',
    name: '센터 운영자',
    status: 'active',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }) as User;

export const contentRow = (over: Partial<ContentRow> = {}): ContentRow => ({
  id: 'c-1',
  stationId: 's-aewol',
  origin: 'reporter_upload',
  reporterId: 'u-reporter',
  title: '애월 해녀 인터뷰',
  description: null,
  category: 'news',
  cultureTopics: [],
  status: 'draft',
  priority: 'normal',
  reviewPolicy: 'reporter_then_center',
  generation: 1,
  scenes: [],
  targetChannelAccountIds: [],
  tags: [],
  remakeOfContentId: null,
  lastError: null,
  durationSec: null,
  approvedByUserId: null,
  approvedAt: null,
  publishedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const stationRow = (over: Partial<StationRow> = {}): StationRow => ({
  id: 's-aewol',
  code: 'aewol',
  name: '애월 마을방송국',
  kind: 'branch',
  status: 'dormant',
  region: '제주시 애월읍',
  description: null,
  thumbnailUrl: null,
  sortOrder: 1,
  foundedAt: null,
  dormantSince: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const channelAccountRow = (over: Partial<ChannelAccountRow> = {}): ChannelAccountRow => ({
  id: 'ch-aewol',
  platform: 'kakao',
  stationId: 's-aewol',
  name: '애월 마을방송국 카카오톡 채널',
  externalChannelId: 'kakao-aewol',
  credentialRef: 'kakao:aewol',
  capabilities: ['vod_publish'],
  status: 'connected',
  connectedAt: NOW,
  expiresAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const publicationRow = (over: Partial<PublicationRow> = {}): PublicationRow => ({
  id: 'pub-1',
  sourceKind: 'content',
  contentId: 'c-1',
  liveSessionId: null,
  channelAccountId: 'ch-aewol',
  platform: 'kakao',
  status: 'queued',
  externalPostId: null,
  externalUrl: null,
  attempts: 0,
  errorMessage: null,
  requestedByUserId: 'u-center',
  queuedAt: NOW,
  publishedAt: null,
  retractedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

export const sceneJson = (order: number, id: string = uuidv7()) => ({
  id,
  order,
  caption: `장면 ${order}`,
  startSec: null,
  endSec: null,
});

/**
 * Prisma mock — $transaction은 배열(promise 배열)·콜백(인터랙티브) 양쪽 지원.
 * 콜백형은 tx = 자기 자신(mock 공유).
 */
export const makePrismaMock = () => {
  const prisma: any = {
    content: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    station: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: jest.fn() },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    revisionRequest: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    statusTransitionLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    channelAccount: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    publication: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  return prisma;
};
