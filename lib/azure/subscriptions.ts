import { z } from 'zod';
import { API_VERSIONS } from './api-versions';
import { ARM_HOST, armList } from './arm-client';

const Subscription = z.object({
  subscriptionId: z.string(),
  displayName: z.string(),
  state: z.string(),
  tenantId: z.string().optional(),
});

export type Subscription = z.infer<typeof Subscription>;

export function listSubscriptions(accessToken: string): Promise<Subscription[]> {
  return armList(
    `${ARM_HOST}/subscriptions?api-version=${API_VERSIONS.subscriptions}`,
    accessToken,
    Subscription,
  );
}
