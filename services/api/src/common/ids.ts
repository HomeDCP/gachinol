import { toId } from '@gachinol/shared';
import type { Brand } from '@gachinol/shared';
import { v7 as uuidv7 } from 'uuid';

/** 앱 발급 UUID v7 (시간순 정렬·커서 겸용) — DB default 미사용, 트랜잭션 내 선참조 가능 */
export const newId = <T extends Brand<string, string>>(): T => toId<T>(uuidv7());
