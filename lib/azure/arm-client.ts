import { z } from 'zod';

export const ARM_HOST = 'https://management.azure.com';

/** Max pages followed per list call; guards against a nextLink loop. */
const MAX_PAGES = 50;

const ArmErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

export class ArmError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArmError';
  }
}

/** Read-only ARM GET. Only ARM hosts are accepted, so a nextLink can't redirect us. */
export async function armGet<T>(
  url: string,
  accessToken: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (new URL(url).origin !== ARM_HOST) throw new Error(`Refusing non-ARM URL: ${url}`);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ArmErrorBody.safeParse(json);
    throw err.success
      ? new ArmError(res.status, err.data.error.code, err.data.error.message ?? err.data.error.code)
      : new ArmError(res.status, 'http_error', `ARM returned HTTP ${res.status}`);
  }
  return schema.parse(json);
}

/** GETs a paged ARM list and follows `nextLink` until the last page. */
export async function armList<T>(
  url: string,
  accessToken: string,
  item: z.ZodType<T>,
): Promise<T[]> {
  const page = z.object({ value: z.array(item), nextLink: z.string().nullish() });
  const items: T[] = [];
  let next: string | null | undefined = url;
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const result: z.infer<typeof page> = await armGet(next, accessToken, page);
    items.push(...result.value);
    next = result.nextLink;
  }
  return items;
}
