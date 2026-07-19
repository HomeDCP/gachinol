declare const __brand: unique symbol;

/** 명목 타이핑용 브랜드. 런타임 흔적 없음 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
