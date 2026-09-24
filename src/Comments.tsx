import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  ThumbsUp,
  Pencil,
  MessageSquare,
  CornerDownRight,
  X,
  Trash2,
  Clock3,
  Send,
} from 'lucide-react';
import type { Asset, Comment, Kind } from './types';
import { api, parseTime, timecode } from './types';
type Props = {
  asset: Asset;
  comments: Comment[];
  author: string;
  time: number;
  anchor: { time: number; token: number } | null;
  onSeek: (time: number) => void;
  onRefresh: () => Promise<void>;
  onPause: () => void;
};
export function Comments({
  asset,
  comments,
  author,
  time,
  anchor,
  onSeek,
  onRefresh,
  onPause,
}: Props) {
  const storageKey = `cutroom-draft-${asset.id}`;
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
      return {};
    }
  };
  const [initial] = useState(load),
    [body, setBody] = useState(initial.body || ''),
    [kind, setKind] = useState<Kind>(initial.kind || 'note'),
    [start, setStart] = useState(initial.start || '00:00.00'),
    [end, setEnd] = useState(initial.end || ''),
    [range, setRange] = useState(Boolean(initial.end));
  const [filter, setFilter] = useState('open'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ body, kind, start, end: range ? end : '' }),
      );
    } catch {}
  }, [body, kind, start, end, range, storageKey]);
  useEffect(() => {
    if (anchor) {
      setStart(timecode(anchor.time, true));
      if (range) setEnd(timecode(Math.min(asset.duration, anchor.time + 5), true));
      input.current?.focus();
    }
  }, [anchor]);
  const parents = comments.filter((c) => !c.parentId),
    visible = parents.filter(
      (c) => filter === 'all' || (filter === 'resolved' ? c.resolved : !c.resolved),
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const from = parseTime(start),
      to = range ? parseTime(end) : null;
    if (
      !Number.isFinite(from) ||
      from < 0 ||
      from > asset.duration ||
      (to !== null && (!Number.isFinite(to) || to <= from || to > asset.duration))
    ) {
      setError('Use a time within this video. A range must end after it starts.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/assets/${asset.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ author, body, kind, time: from, endTime: to }),
      });
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      setBody('');
      setRange(false);
      setEnd('');
      setSaved(true);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="review-panel" aria-label="Review comments">
      <div className="review-heading">
        <div>
          <h2>
            Review notes <span>{parents.length}</span>
          </h2>
          <p>Good moments. Better next cuts.</p>
        </div>
        <MessageSquare size={20} />
      </div>
      <div className="comment-tabs" role="group" aria-label="Filter comments">
        {['open', 'resolved', 'all'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'active' : ''}
            aria-pressed={filter === f}
          >
            {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}{' '}
            <span>
              {
                parents.filter((c) => f === 'all' || (f === 'resolved' ? c.resolved : !c.resolved))
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="comment-list">
        {!visible.length ? (
          <div className="empty-comments">
            <div className="empty-comment-icon">
              <MessageSquare size={27} />
            </div>
            <h3>{parents.length ? 'All caught up.' : 'What’s working in this cut?'}</h3>
            <p>
              {parents.length
                ? 'No notes in this view. Switch tabs to see the rest.'
                : 'Pause on a moment and press C. Mark a section to keep, suggest a change, or leave a note.'}
            </p>
          </div>
        ) : (
          visible.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              replies={comments.filter((r) => r.parentId === c.id)}
              author={author}
              onSeek={onSeek}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
      <form className="composer" onSubmit={submit}>
        <div className="composer-top">
          <span className="small-avatar">{author.slice(0, 2).toUpperCase()}</span>
          <b>{author}</b>
          <span className="save-state" role="status">
            {busy ? 'Saving…' : saved ? 'Saved on this Mac' : ''}
          </span>
        </div>
        <div className="kind-picker" role="group" aria-label="Feedback type">
          {(
            [
              ['note', MessageSquare, 'Note'],
              ['keep', ThumbsUp, 'Keep this'],
              ['change', Pencil, 'Change'],
            ] as const
          ).map(([k, Icon, label]) => (
            <button
              key={k}
              type="button"
              className={kind === k ? `selected ${k}` : ''}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <textarea
          ref={input}
          disabled={busy}
          aria-label="Your comment"
          placeholder={
            kind === 'keep'
              ? 'What do you like about this moment?'
              : kind === 'change'
                ? 'What should change in the next edit?'
                : 'Leave a note on this moment…'
          }
          value={body}
          maxLength={5000}
          onFocus={() => {
            onPause();
            if (!body && !anchor) setStart(timecode(time, true));
          }}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="time-fields">
          <Clock3 size={14} />
          <input
            aria-label="Comment start time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="00:00.00"
          />
          {range && (
            <>
              <span>to</span>
              <input
                aria-label="Comment end time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="00:05.00"
              />
            </>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setStart(timecode(time, true));
              if (range) setEnd(timecode(Math.min(asset.duration, time + 5), true));
            }}
          >
            At playhead
          </button>
        </div>
        <div className="composer-bottom">
          <label className="range-check">
            <input
              type="checkbox"
              checked={range}
              onChange={(e) => {
                setRange(e.target.checked);
                if (e.target.checked)
                  setEnd(timecode(Math.min(asset.duration, parseTime(start) + 5), true));
              }}
            />
            Time range
          </label>
          <button className="primary" disabled={!body.trim() || busy} type="submit">
            <Send size={14} />
            {busy ? 'Saving…' : 'Post comment'}
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </aside>
  );
}
function CommentCard({
  comment: c,
  replies,
  author,
  onSeek,
  onRefresh,
}: {
  comment: Comment;
  replies: Comment[];
  author: string;
  onSeek: (time: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [reply, setReply] = useState<string | null>(null),
    [edit, setEdit] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`comment-card ${c.resolved ? 'is-resolved' : ''}`}>
      <div className="comment-meta">
        <span className={`small-avatar ${c.kind}`}>{c.author.slice(0, 2).toUpperCase()}</span>
        <b>{c.author}</b>
        <time dateTime={c.createdAt}>
          {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </time>
        <button
          className={`resolve-button ${c.resolved ? 'checked' : ''}`}
          title={c.resolved ? 'Reopen note' : 'Resolve note'}
          aria-label={c.resolved ? 'Reopen note' : 'Resolve note'}
          disabled={busy}
          onClick={() =>
            action(() =>
              api(`/comments/${c.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ resolved: !c.resolved }),
              }),
            )
          }
        >
          {c.resolved ? <CheckCheck size={16} /> : <Check size={16} />}
        </button>
      </div>
      <div className="comment-labels">
        <button className="timestamp" onClick={() => onSeek(c.time)}>
          {timecode(c.time)}
          {c.endTime !== null ? ` – ${timecode(c.endTime)}` : ''}
        </button>
        <span className={`kind-tag ${c.kind}`}>
          {c.kind === 'keep' ? 'Keep this' : c.kind === 'change' ? 'Change' : 'Note'}
        </span>
      </div>
      {edit === null ? (
        <p className="comment-body">{c.body}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await api(`/comments/${c.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ body: edit }),
              });
              setEdit(null);
            });
          }}
        >
          <textarea
            autoFocus
            aria-label="Edit comment"
            value={edit}
            maxLength={5000}
            onChange={(e) => setEdit(e.target.value)}
          />
          <div className="inline-actions">
            <button type="button" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button disabled={busy || !edit.trim()}>Save edit</button>
          </div>
        </form>
      )}
      <div className="comment-actions">
        <button onClick={() => setReply(reply === null ? '' : null)}>
          Reply {replies.length || ''}
        </button>
        <button onClick={() => setEdit(c.body)}>Edit</button>
        <button
          title="Delete note"
          aria-label="Delete note"
          onClick={() => {
            if (confirm('Delete this note and its replies?'))
              action(() => api(`/comments/${c.id}`, { method: 'DELETE' }));
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {replies.map((r) => (
        <div className="reply" key={r.id}>
          <CornerDownRight size={14} />
          <div>
            <b>{r.author}</b>
            <p>{r.body}</p>
          </div>
          <button
            className="text-button"
            aria-label="Delete reply"
            disabled={busy}
            onClick={() => {
              if (confirm('Delete this reply?'))
                action(() => api(`/comments/${r.id}`, { method: 'DELETE' }));
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {reply !== null && (
        <form
          className="reply-form"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await api(`/assets/${c.assetId}/comments`, {
                method: 'POST',
                body: JSON.stringify({
                  parentId: c.id,
                  body: reply,
                  author,
                  time: c.time,
                  kind: 'note',
                }),
              });
              setReply(null);
            });
          }}
        >
          <textarea
            autoFocus
            aria-label="Reply text"
            placeholder="Reply to this note…"
            value={reply}
            maxLength={5000}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="inline-actions">
            <button type="button" onClick={() => setReply(null)}>
              Cancel
            </button>
            <button disabled={busy || !reply.trim()}>Post reply</button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
