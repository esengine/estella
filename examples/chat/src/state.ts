import type { ListViewHandle, ArrayDataSource, TextInputHandle } from 'esengine';

import type { Message } from './config';

export const state = {
    list: null as ListViewHandle<Message> | null,
    // The backing store: list.data is the readonly DataSource view; mutations
    // (append) live on ArrayDataSource.
    messages: null as ArrayDataSource<Message> | null,
    input: null as TextInputHandle | null,
    nextId: 0,
    botTurn: 0,
    built: false,
};
