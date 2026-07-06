import type { Entity, ListViewHandle, ArrayDataSource } from 'esengine';

import type { Contact } from './config';

export const state = {
    list: null as ListViewHandle<Contact> | null,
    grid: null as ListViewHandle<number> | null,
    // Typed handle to the list's backing store (list.data is the readonly
    // DataSource view; mutations — append/remove — live on ArrayDataSource).
    contacts: null as ArrayDataSource<Contact> | null,
    statsLabel: null as Entity | null,
    nextId: 0,
    lastStats: '',
};
