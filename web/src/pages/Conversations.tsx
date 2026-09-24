import { useState } from 'react';
import { api, ConversationChat, ConversationMessage } from '../lib/api';
import { formatDate, errMsg } from '../lib/utils';
import { SearchBar } from '../components/SearchBar';
import { Markdown } from '../components/Markdown';
import { ListRow } from '../components/List';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Alert } from '../components/Alert';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ChatAvatar } from '../components/ChatAvatar';

export function Conversations() {
  const [filter, setFilter] = useState('');

  const { data: chats, loading, error, reload, setError } = useResource<ConversationChat[]>(
    () => api.getConversations().then((r) => r.data ?? []),
    [],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const selectChat = async (chatId: string) => {
    if (selectedId === chatId) return;
    setSelectedId(chatId);
    setMessages([]);
    setMessagesLoading(true);
    try {
      const res = await api.getConversationMessages(chatId);
      setMessages(res.data ?? []);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setMessagesLoading(false);
    }
  };

  const lowerFilter = filter.toLowerCase();
  const allChats = chats ?? [];
  const filtered = lowerFilter
    ? allChats.filter(
        (c) =>
          (c.title ?? '').toLowerCase().includes(lowerFilter) ||
          (c.username ?? '').toLowerCase().includes(lowerFilter) ||
          c.id.toLowerCase().includes(lowerFilter),
      )
    : allChats;

  const selected = allChats.find((c) => c.id === selectedId) ?? null;
  const selectedName = selected ? (selected.title || selected.username || selected.id) : '';
  const selectedIsGroup = selected ? selected.type !== 'dm' : false;

  return (
    <div>
      <div className="header">
        <h1>Chats</h1>
        <p>{allChats.length} {allChats.length === 1 ? 'conversation' : 'conversations'}</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      <div className="chat-layout">
        <aside className="chat-list-pane">
          <div className="chat-list-head">
            <div style={{ flex: 1 }}>
              <SearchBar value={filter} onChange={setFilter} placeholder="Filter chats…" />
            </div>
            <RefreshButton onRefresh={reload} />
          </div>

          <div className="chat-list-scroll">
            {loading ? (
              <div style={{ padding: '12px' }}><SkeletonRows /></div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title={filter ? 'No matching chats' : 'No conversations'}
                description={filter ? undefined : 'Chat history appears here once the agent starts talking.'}
                action={filter ? <button className="btn-ghost btn-sm" onClick={() => setFilter('')}>Clear filter</button> : undefined}
              />
            ) : (
              filtered.map((chat) => {
                const name = chat.title || chat.username || chat.id;
                return (
                  <ListRow
                    key={chat.id}
                    className={chat.id === selectedId ? 'selected' : undefined}
                    leading={<ChatAvatar chatId={chat.id} name={name} />}
                    leadingClassName="chat-list-avatar"
                    title={name}
                    subtitle={`${chat.type} · ${chat.message_count} ${chat.message_count === 1 ? 'msg' : 'msgs'}`}
                    onClick={() => selectChat(chat.id)}
                  />
                );
              })
            )}
          </div>
        </aside>

        <section className="chat-detail-pane">
          {!selected ? (
            <EmptyState title="Select a conversation" description="Choose a chat to view its messages." />
          ) : (
            <>
              <div className="chat-detail-head">
                <ChatAvatar chatId={selected.id} name={selectedName} />
                <div style={{ minWidth: 0 }}>
                  <div className="ios-row-title">{selectedName}</div>
                  <div className="ios-row-sub">{selected.type} · {selected.message_count} {selected.message_count === 1 ? 'message' : 'messages'}</div>
                </div>
              </div>
              <div className="chat-detail-body">
                {messagesLoading ? (
                  <div style={{ padding: '16px' }}><SkeletonRows rows={5} /></div>
                ) : messages.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>
                    No messages
                  </div>
                ) : (
                  <div className="chat-thread">
                    {messages.map((msg) => {
                      const out = msg.is_from_agent === 1;
                      return (
                        <div key={msg.id} className={`chat-msg ${out ? 'out' : 'in'}`}>
                          {!out && selectedIsGroup && <span className="chat-sender">{msg.sender_id || 'Unknown'}</span>}
                          {msg.text ? (
                            <div className="chat-bubble"><Markdown>{msg.text}</Markdown></div>
                          ) : (
                            <div className="chat-bubble media">
                              {msg.has_media ? `[${msg.media_type || 'media'}]` : '[empty]'}
                            </div>
                          )}
                          <span className="chat-time">{formatDate(msg.timestamp, 1000)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
