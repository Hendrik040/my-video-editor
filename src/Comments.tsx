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
  ImagePlus,
  LoaderCircle,
} from 'lucide-react';
import type { Asset, Comment, Drawing, ImageAttachment, Kind, Reference } from './types';
import { api, parseTime, timecode } from './types';
const MAX_IMAGES = 10;
async function uploadImage(assetId: string, file: File): Promise<ImageAttachment> {
  const data = new FormData();
  data.append('image', file);
  const response = await fetch(`/api/assets/${assetId}/images`, { method: 'POST', body: data });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.error || 'That image could not be attached.');
  }
  const body = await response.json();
  return { name: body.name, width: body.width, height: body.height };
}
function imageFilesFrom(items: DataTransferItemList | null, files: FileList | null): File[] {
  const found: File[] = [];
  if (items)
    for (const item of items)
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) found.push(file);
      }
  if (!found.length && files)
    for (const file of files) if (file.type.startsWith('image/')) found.push(file);
  return found;
}
type Props = {
  asset: Asset;
  comments: Comment[];
  author: string;
  time: number;
  anchor: { time: number; token: number } | null;
  drawingDraft: { time: number; drawings: Drawing[] } | null;
  onClearDrawing: () => void;
  onShowComment: (comment: Comment) => void;
  onSavingChange: (busy: boolean) => void;
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
  drawingDraft,
  onClearDrawing,
  onShowComment,
  onSavingChange,
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
    [range, setRange] = useState(Boolean(initial.end)),
    [references, setReferences] = useState<Reference[]>(() =>
      Array.isArray(initial.references)
        ? initial.references
            .filter((reference: Reference) => reference && typeof reference.url === 'string')
            .slice(0, 5)
            .map((reference: Reference) => ({
              url: reference.url,
              title: typeof reference.title === 'string' ? reference.title : '',
            }))
        : [],
    ),
    [images, setImages] = useState<ImageAttachment[]>(() =>
      Array.isArray(initial.images)
        ? initial.images
            .filter((image: ImageAttachment) => image && typeof image.name === 'string')
            .slice(0, MAX_IMAGES)
        : [],
    );
  const hasDrawing = Boolean(drawingDraft?.drawings.length);
  const hasImages = images.length > 0;
  const [filter, setFilter] = useState('open'),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(0),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  async function attachImages(files: File[]) {
    if (!files.length) return;
    setError('');
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(`Attach at most ${MAX_IMAGES} images per note.`);
      return;
    }
    setSaved(false);
    setUploading((count) => count + 1);
    try {
      for (const file of files.slice(0, room)) {
        const attachment = await uploadImage(asset.id, file);
        if (!mounted.current) return;
        setImages((current) => (current.length >= MAX_IMAGES ? current : [...current, attachment]));
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setUploading((count) => count - 1);
    }
  }
  const mounted = useMounted();
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ body, kind, start, end: range ? end : '', references, images }),
      );
    } catch {}
  }, [body, kind, start, end, range, references, images, storageKey]);
  useEffect(() => {
    if (anchor) {
      if (!hasDrawing) {
        setStart(timecode(anchor.time, true));
        if (range) setEnd(timecode(Math.min(asset.duration, anchor.time + 5), true));
      }
      input.current?.focus();
    }
  }, [anchor]);
  useEffect(() => {
    if (drawingDraft?.drawings.length) {
      setStart(timecode(drawingDraft.time, true));
      setRange(false);
      setEnd('');
      setSaved(false);
    }
  }, [drawingDraft]);
  const parents = comments.filter((c) => !c.parentId),
    visible = parents.filter(
      (c) => filter === 'all' || (filter === 'resolved' ? c.resolved : !c.resolved),
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !body.trim()) return;
    const from = hasDrawing && drawingDraft ? drawingDraft.time : parseTime(start),
      to = range && !hasDrawing ? parseTime(end) : null,
      referenceAttachments = references.map((reference) => ({
        url: reference.url.trim(),
        ...(reference.title?.trim() ? { title: reference.title.trim() } : {}),
      }));
    if (
      !Number.isFinite(from) ||
      from < 0 ||
      from > asset.duration ||
      (to !== null && (!Number.isFinite(to) || to <= from || to > asset.duration))
    ) {
      setError('Use a time within this video. A range must end after it starts.');
      return;
    }
    if (referenceAttachments.some((reference) => !isHttpReference(reference.url))) {
      setError('References need a full http:// or https:// link.');
      return;
    }
    if (uploading > 0) {
      setError('Wait for the image to finish attaching.');
      return;
    }
    setBusy(true);
    onSavingChange(true);
    setError('');
    try {
      await api(`/assets/${asset.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          author,
          body,
          kind,
          time: from,
          endTime: to,
          drawings: drawingDraft?.drawings || [],
          references: referenceAttachments,
          images: to === null ? images : [],
        }),
      });
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      onClearDrawing();
      if (!mounted.current) return;
      setBody('');
      setRange(false);
      setEnd('');
      setReferences([]);
      setImages([]);
      setSaved(true);
      await onRefresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      onSavingChange(false);
      if (mounted.current) setBusy(false);
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
              onShowComment={onShowComment}
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
          aria-describedby="comment-shortcuts"
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
            if (!body && !anchor && !hasDrawing) setStart(timecode(time, true));
          }}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              if (!e.repeat && !busy && body.trim()) e.currentTarget.form?.requestSubmit();
            }
          }}
          onPaste={(e) => {
            const files = imageFilesFrom(e.clipboardData.items, e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              attachImages(files);
            }
          }}
        />
        <div className="composer-attach">
          <p className="comment-shortcuts" id="comment-shortcuts">
            Enter to post · Shift+Enter for a new line · paste a screenshot to attach it
          </p>
          <input
            ref={imageInput}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            aria-label="Attach images"
            onChange={(e) => {
              attachImages([...(e.target.files || [])]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="attach-image-button"
            disabled={busy || images.length >= MAX_IMAGES}
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus size={13} /> Attach image
          </button>
        </div>
        {(images.length > 0 || uploading > 0) && (
          <div className="image-draft" aria-label="Attached images">
            {images.map((image) => (
              <div className="image-draft-item" key={image.name}>
                <img src={`/api/attachments/${image.name}`} alt="Attached screenshot" />
                <button
                  type="button"
                  aria-label="Remove image"
                  disabled={busy}
                  onClick={() => {
                    setImages((current) => current.filter((item) => item.name !== image.name));
                    setSaved(false);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {uploading > 0 && (
              <div className="image-draft-item image-draft-loading">
                <LoaderCircle size={18} className="spin" />
              </div>
            )}
          </div>
        )}
        {hasDrawing && drawingDraft && (
          <div className="drawing-note-hint">
            <p>Drawing pinned to {timecode(drawingDraft.time)}. Clear it to change the time.</p>
            <button
              type="button"
              className="clear-drawing-button"
              disabled={busy}
              onClick={onClearDrawing}
            >
              <X size={13} /> Clear drawing
            </button>
          </div>
        )}
        <div className="time-fields">
          <Clock3 size={14} />
          <input
            aria-label="Comment start time"
            value={hasDrawing && drawingDraft ? timecode(drawingDraft.time, true) : start}
            disabled={busy || hasDrawing}
            onChange={(e) => setStart(e.target.value)}
            placeholder="00:00.00"
          />
          {range && !hasDrawing && (
            <>
              <span>to</span>
              <input
                aria-label="Comment end time"
                disabled={busy}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="00:05.00"
              />
            </>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy || hasDrawing}
            onClick={() => {
              setStart(timecode(time, true));
              if (range) setEnd(timecode(Math.min(asset.duration, time + 5), true));
            }}
          >
            At playhead
          </button>
        </div>
        <div className="reference-draft">
          <div className="reference-draft-heading">
            <span>Reference links</span>
            <span>{references.length}/5</span>
          </div>
          {references.length > 0 && (
            <div className="reference-draft-list">
              {references.map((reference, index) => (
                <div className="reference-draft-row" key={index}>
                  <div className="reference-draft-fields">
                    <input
                      type="url"
                      aria-label={`Reference ${index + 1} URL`}
                      placeholder="https://example.com"
                      value={reference.url}
                      maxLength={2048}
                      disabled={busy}
                      required
                      onChange={(e) => {
                        setReferences((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, url: e.target.value } : item,
                          ),
                        );
                        setSaved(false);
                      }}
                    />
                    <input
                      aria-label={`Reference ${index + 1} title`}
                      placeholder="Title (optional)"
                      value={reference.title || ''}
                      maxLength={160}
                      disabled={busy}
                      onChange={(e) => {
                        setReferences((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, title: e.target.value } : item,
                          ),
                        );
                        setSaved(false);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="remove-reference-button"
                    aria-label={`Remove reference ${index + 1}`}
                    disabled={busy}
                    onClick={() => {
                      setReferences((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      );
                      setSaved(false);
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="add-reference-button"
            disabled={busy || references.length >= 5}
            onClick={() => {
              setReferences((current) => [...current, { url: '', title: '' }]);
              setSaved(false);
            }}
          >
            Add reference
          </button>
        </div>
        <div className="composer-bottom">
          <label className="range-check">
            <input
              type="checkbox"
              checked={range && !hasDrawing && !hasImages}
              disabled={busy || hasDrawing || hasImages}
              onChange={(e) => {
                setRange(e.target.checked);
                if (e.target.checked)
                  setEnd(timecode(Math.min(asset.duration, parseTime(start) + 5), true));
              }}
            />
            Time range
          </label>
          <button
            className="primary"
            disabled={!body.trim() || busy || uploading > 0}
            type="submit"
          >
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
  onShowComment,
  onRefresh,
}: {
  comment: Comment;
  replies: Comment[];
  author: string;
  onShowComment: (comment: Comment) => void;
  onRefresh: () => Promise<void>;
}) {
  const [reply, setReply] = useState<string | null>(null),
    [edit, setEdit] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const mounted = useMounted();
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (!mounted.current) return;
      await onRefresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
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
        <button className="timestamp" onClick={() => onShowComment(c)}>
          {timecode(c.time)}
          {c.endTime !== null ? ` – ${timecode(c.endTime)}` : ''}
        </button>
        <span className={`kind-tag ${c.kind}`}>
          {c.kind === 'keep' ? 'Keep this' : c.kind === 'change' ? 'Change' : 'Note'}
        </span>
        {Boolean(c.drawings?.length) && <span className="drawing-tag">Drawing</span>}
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
              if (mounted.current) setEdit(null);
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
      <ImageAttachments images={c.images} />
      <ReferenceLinks references={c.references} />
      <div className="comment-actions">
        {Boolean(c.drawings?.length) && (
          <button className="show-drawing-button" onClick={() => onShowComment(c)}>
            Show drawing
          </button>
        )}
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
            <ImageAttachments images={r.images} />
            <ReferenceLinks references={r.references} />
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
              if (mounted.current) setReply(null);
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

function isHttpReference(url: string) {
  if (!/^https?:\/\//i.test(url) || /[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function ImageAttachments({ images }: { images?: ImageAttachment[] }) {
  const safe = (images || []).filter((image) =>
    /^[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/i.test(image.name),
  );
  if (!safe.length) return null;
  return (
    <div className="comment-images" aria-label="Attached images">
      {safe.map((image) => (
        <a
          key={image.name}
          href={`/api/attachments/${image.name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="comment-image"
        >
          <img
            src={`/api/attachments/${image.name}`}
            alt="Attached screenshot"
            loading="lazy"
            width={image.width}
            height={image.height}
          />
        </a>
      ))}
    </div>
  );
}
function ReferenceLinks({ references }: { references?: Reference[] }) {
  const safeReferences = references?.filter((reference) => isHttpReference(reference.url)) || [];
  if (!safeReferences.length) return null;
  return (
    <ul className="comment-references" aria-label="Reference links">
      {safeReferences.map((reference, index) => (
        <li key={`${reference.url}-${index}`}>
          <a
            className="comment-reference-link"
            href={reference.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {reference.title || reference.url}
          </a>
        </li>
      ))}
    </ul>
  );
}
