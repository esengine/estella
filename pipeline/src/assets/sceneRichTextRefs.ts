// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { parseRichText } from '../../../sdk/src/ui/text/rich-text-parser';

/** Test images in a Text component or in a prefab override. */
export function someRichTextImageRef(value: object, documentType: string, test: (ref: string) => boolean): boolean {
  const row = value as {
    type?: string; data?: Record<string, unknown>;
    componentType?: string; propertyName?: string; value?: unknown;
  };
  // A prefab instance can override either the markup or its richText switch.
  const content = row.type === 'Text' && (row.data?.richText || documentType === 'prefab') ? row.data?.content
    : row.type === 'property' && row.componentType === 'Text' && row.propertyName === 'content' ? row.value : undefined;
  if (typeof content !== 'string' || !content.includes('<img')) return false;
  for (const line of content.split('\n')) {
    for (const run of parseRichText(line)) if (run.type === 'image' && test(run.src)) return true;
  }
  return false;
}
