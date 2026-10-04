import { storage } from 'wxt/utils/storage';

/**
 * Spike threshold: flag when projected month-end is more than this many
 * percent above last month. Editable on the options page from M5.
 */
export const spikeThresholdPctItem = storage.defineItem<number>(
  'local:settings.spikeThresholdPct',
  {
    fallback: 50,
  },
);
