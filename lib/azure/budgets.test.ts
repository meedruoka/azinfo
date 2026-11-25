import { describe, expect, it } from 'vitest';
import { budgetsUrl, toMonthlyBudget } from './budgets';

const budget = (properties: Record<string, unknown>, name = 'b1') => ({
  name,
  properties: {
    category: 'Cost',
    amount: 100,
    timeGrain: 'Monthly',
    currentSpend: { amount: 40, unit: 'EUR' },
    ...properties,
  },
});

describe('budgets', () => {
  it('lists budgets at the resource group scope', () => {
    expect(budgetsUrl('s', 'my rg')).toBe(
      'https://management.azure.com/subscriptions/s/resourceGroups/my%20rg/providers/Microsoft.Consumption/budgets?api-version=2023-05-01',
    );
  });

  it('keeps a monthly cost budget that covers the whole scope', () => {
    expect(toMonthlyBudget(budget({}))).toEqual({ name: 'b1', amount: 100, currency: 'EUR' });
    expect(toMonthlyBudget(budget({ timeGrain: 'BillingMonth', filter: {} }))).not.toBeNull();
  });

  it.each([
    ['a quarterly budget', { timeGrain: 'Quarterly' }],
    ['a usage budget', { category: 'Usage' }],
    ['a zero amount', { amount: 0 }],
    [
      'a budget filtered to some resources',
      { filter: { dimensions: { name: 'ResourceId', operator: 'In', values: ['x'] } } },
    ],
    [
      'a budget filtered by tag',
      { filter: { tags: { name: 'env', operator: 'In', values: ['p'] } } },
    ],
  ])('leaves out %s', (_, properties) => {
    expect(toMonthlyBudget(budget(properties))).toBeNull();
  });
});
