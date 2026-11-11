import { Fragment, type ReactNode } from 'react';
import { type MessageKey, tParts } from './i18n';

/** A translated message with elements (bold names, code) in its `$1`…`$9` slots. */
export function T({ k, slots }: { k: MessageKey; slots: ReactNode[] }) {
  return (
    <>
      {tParts(k, slots.length).map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
        <Fragment key={i}>{typeof part === 'number' ? slots[part - 1] : part}</Fragment>
      ))}
    </>
  );
}
