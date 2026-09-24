export function ChatAvatar({ chatId, name }: { chatId: string; name: string }) {
  return (
    <span className="chat-avatar" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
      <img
        key={chatId}
        src={`/api/conversations/${encodeURIComponent(chatId)}/photo`}
        alt=""
        loading="lazy"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}
