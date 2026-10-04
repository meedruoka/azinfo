import { describe, expect, it } from 'vitest';
import { describeResourceId } from './resource-id';

describe('describeResourceId', () => {
  it('returns the name and full type of a top-level resource', () => {
    expect(
      describeResourceId(
        '/subscriptions/s/resourcegroups/rg/providers/microsoft.cognitiveservices/accounts/ai-one',
      ),
    ).toEqual({ name: 'ai-one', type: 'microsoft.cognitiveservices/accounts' });
  });

  it('includes child types for nested resources', () => {
    expect(
      describeResourceId(
        '/subscriptions/s/resourcegroups/rg/providers/microsoft.sql/servers/s1/databases/db1',
      ),
    ).toEqual({ name: 'db1', type: 'microsoft.sql/servers/databases' });
  });

  it('falls back to the last segment when there is no provider part', () => {
    expect(describeResourceId('/subscriptions/s/resourcegroups/rg')).toEqual({
      name: 'rg',
      type: '',
    });
  });
});
