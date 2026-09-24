import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Film,
  Plus,
  FolderOpen,
  Upload,
  Download,
  ChevronRight,
  Monitor,
  CircleHelp,
  X,
  HardDrive,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { Player } from './Player';
import { Comments } from './Comments';
import { api, savedName, timecode, type Asset, type Comment, type Project } from './types';
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState(''),
    [assetId, setAssetId] = useState(new URLSearchParams(location.search).get('cut') || '');
  const [comments, setComments] = useState<Comment[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [modal, setModal] = useState<'project' | 'upload' | 'help' | 'profile' | null>(null),
    [author, setAuthor] = useState(savedName),
    [time, setTime] = useState(0);
  const [anchor, setAnchor] = useState<{ time: number; token: number } | null>(null),
    [seekTarget, setSeekTarget] = useState<{ time: number; token: number } | null>(null);
  const activeId = useRef(assetId);
  activeId.current = assetId;
  const project =
    projects.find((p) => p.id === projectId) ||
    projects.find((p) => p.assets.some((a) => a.id === assetId)) ||
    projects[0];
  const asset =
    project?.assets.find((a) => a.id === assetId) ||
    project?.assets.find((a) => /waterfront/i.test(a.title)) ||
    project?.assets.at(-1);
  activeId.current = asset?.id || '';
  async function loadLibrary() {
    const data = await api<Project[]>('/library');
    setProjects(data);
    return data;
  }
  useEffect(() => {
    loadLibrary()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!asset) return;
    setComments([]);
    setTime(0);
    setAnchor(null);
    setError('');
    const controller = new AbortController();
    api<Comment[]>(`/assets/${asset.id}/comments`, { signal: controller.signal })
      .then(setComments)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    const params = new URLSearchParams(location.search);
    setSeekTarget({
      time: params.get('cut') === asset.id ? Math.max(0, Number(params.get('t')) || 0) : 0,
      token: Date.now(),
    });
    return () => controller.abort();
  }, [asset?.id]);
  useEffect(() => {
    const back = () => {
      const params = new URLSearchParams(location.search);
      setProjectId('');
      setAssetId(params.get('cut') || '');
      setSeekTarget({ time: Number(params.get('t')) || 0, token: Date.now() });
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    };
    window.addEventListener('focus', update);
    const interval = window.setInterval(update, 15000);
    return () => {
      window.removeEventListener('focus', update);
      clearInterval(interval);
    };
  }, [asset?.id]);
  const capture = useCallback((at: number) => setAnchor({ time: at, token: Date.now() }), []);
  function selectAsset(a: Asset) {
    setAssetId(a.id);
    setProjectId(a.projectId);
    const url = new URL(location.href);
    url.searchParams.set('cut', a.id);
    url.searchParams.delete('t');
    history.pushState({}, '', url);
  }
  async function refresh() {
    const id = asset?.id;
    const [data, cs] = await Promise.all([
      api<Project[]>('/library'),
      id ? api<Comment[]>(`/assets/${id}/comments`) : Promise.resolve([]),
    ]);
    setProjects(data);
    if (activeId.current === id) setComments(cs);
  }
  function seek(at: number) {
    document.querySelector('video')?.pause();
    setSeekTarget({ time: at, token: Date.now() });
  }
  async function status(value: string) {
    if (!asset) return;
    try {
      await api(`/assets/${asset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: value }),
      });
      await loadLibrary();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="studio">
      <aside className="project-rail">
        <a className="wordmark" href="/" aria-label="Cutroom home">
          <span className="brand-symbol">
            <Film size={21} />
          </span>
          cutroom<span className="brand-dot">.</span>
        </a>
        <div className="rail-label">
          <span>Workspace</span>
          <button
            className="icon-button"
            onClick={() => setModal('project')}
            title="New project"
            aria-label="New project"
          >
            <Plus size={17} />
          </button>
        </div>
        <nav aria-label="Projects">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`project-link ${p.id === project?.id ? 'active' : ''}`}
              onClick={() => {
                setProjectId(p.id);
                setAssetId('');
                history.pushState({}, '', '/');
              }}
            >
              <FolderOpen size={17} />
              <span>{p.name}</span>
              <small>{p.assets.length}</small>
            </button>
          ))}
        </nav>
        <button className="new-project" onClick={() => setModal('project')}>
          <Plus size={15} />
          New project
        </button>
        <div className="rail-bottom">
          <div>
            <HardDrive size={14} />
            <span>On this Mac</span>
            <i />
          </div>
          <button onClick={() => setModal('help')}>
            <CircleHelp size={16} />
            Studio guide
          </button>
          <button className="profile-button" onClick={() => setModal('profile')}>
            <span className="avatar">{author.slice(0, 2).toUpperCase()}</span>
            <span>
              {author}
              <small>Reviewer</small>
            </span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Studio</span>
            <ChevronRight size={13} />
            <strong>{project?.name || 'Your projects'}</strong>
          </div>
          <div className="header-actions">
            {project && (
              <a className="button export-button" href={`/api/projects/${project.id}/feedback`}>
                <Download size={15} />
                Export feedback
              </a>
            )}
            <button
              className="primary upload-button"
              onClick={() => setModal(project ? 'upload' : 'project')}
            >
              <Plus size={16} />
              Add video
            </button>
          </div>
        </header>
        {error && (
          <div className="global-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError('');
                refresh().catch((e) => setError(e.message));
              }}
            >
              Retry
            </button>
          </div>
        )}
        {loading ? (
          <div className="workspace-empty">
            <LoaderCircle className="spin" size={32} />
            <h1>Opening the studio…</h1>
          </div>
        ) : !asset ? (
          <div className="workspace-empty">
            <Film size={42} />
            <h1>{project ? 'Ready for a first cut.' : 'A home for your next cut.'}</h1>
            <p>
              Add a video to review it, pin feedback to a moment, and keep your revisions together.
            </p>
            <button className="primary" onClick={() => setModal(project ? 'upload' : 'project')}>
              {project ? 'Add a video' : 'Create a project'}
            </button>
          </div>
        ) : (
          <div className="review-layout">
            <main className="screening-room">
              <div className="cut-heading">
                <div>
                  <h1>{asset.title}</h1>
                  <p>{asset.description || 'A new cut, ready for your feedback.'}</p>
                </div>
                <select
                  className={`status-select ${asset.status}`}
                  aria-label="Review status"
                  value={asset.status}
                  onChange={(e) => status(e.target.value)}
                >
                  <option value="review">Needs review</option>
                  <option value="changes">Changes requested</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
              <Player
                key={asset.id}
                asset={asset}
                comments={comments}
                onComment={capture}
                onTime={setTime}
                seekTarget={seekTarget}
              />
              <div className="video-footnote">
                <span>
                  <Monitor size={13} />
                  {asset.width} × {asset.height}
                  <span className="small-divider" />
                  {asset.fps.toFixed(2)} fps
                </span>
                <span>
                  Space to play
                  <span className="small-divider" />C to comment
                </span>
              </div>
              <section className="versions">
                <div className="versions-heading">
                  <h2>
                    All cuts <span>{project?.assets.length}</span>
                  </h2>
                  <span>Choose a cut to review</span>
                </div>
                <div className="cut-strip" role="list" aria-label="Available cuts">
                  {project?.assets.map((a) => (
                    <div role="listitem" key={a.id}>
                      <button
                        className={`cut-card ${a.id === asset.id ? 'selected' : ''}`}
                        onClick={() => selectAsset(a)}
                        aria-pressed={a.id === asset.id}
                      >
                        <div className="cut-thumbnail">
                          <img src={`/api/assets/${a.id}/thumbnail`} alt="" loading="lazy" />
                          <span className="cut-duration">{timecode(a.duration)}</span>
                          {a.id === asset.id && (
                            <span className="viewing">
                              <Check size={12} />
                              Viewing
                            </span>
                          )}
                        </div>
                        <b>{a.title}</b>
                        <span className="cut-meta">
                          <i className={a.status} />
                          {a.openCount
                            ? `${a.openCount} open ${a.openCount === 1 ? 'note' : 'notes'}`
                            : a.status === 'approved'
                              ? 'Approved'
                              : 'Ready for review'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </main>
            <Comments
              key={asset.id}
              asset={asset}
              comments={comments}
              author={author}
              time={time}
              anchor={anchor}
              onSeek={seek}
              onRefresh={refresh}
              onPause={() => document.querySelector('video')?.pause()}
            />
          </div>
        )}
      </div>
      {modal === 'project' && (
        <ProjectDialog
          onClose={() => setModal(null)}
          onCreated={async (p) => {
            await loadLibrary();
            setProjectId(p.id);
            setAssetId('');
            setModal('upload');
          }}
        />
      )}
      {modal === 'upload' && project && (
        <UploadDialog
          project={project}
          onClose={() => setModal(null)}
          onAdded={async (a) => {
            await loadLibrary();
            selectAsset(a);
            setModal(null);
          }}
        />
      )}
      {modal === 'profile' && (
        <ProfileDialog
          author={author}
          onClose={() => setModal(null)}
          onSave={(name) => {
            setAuthor(name);
            try {
              localStorage.setItem('cutroom-reviewer', name);
            } catch {}
            setModal(null);
          }}
        />
      )}
      {modal === 'help' && (
        <Modal title="Your review studio" onClose={() => setModal(null)}>
          <div className="guide">
            <p>
              Choose a cut, pause on a moment, and leave feedback. Every note belongs to that
              specific cut.
            </p>
            <dl>
              <dt>Space</dt>
              <dd>Play or pause</dd>
              <dt>← / →</dt>
              <dd>Move 5 seconds</dd>
              <dt>Shift + ← / →</dt>
              <dd>Move one frame</dd>
              <dt>C</dt>
              <dd>Pause and start a comment</dd>
              <dt>⌘ / Ctrl + Enter</dt>
              <dd>Post your comment</dd>
            </dl>
            <p>
              <b>Keep this</b> marks what should stay. <b>Change</b> flags what needs another pass.
              Use a time range for longer sections, and click any timestamp to jump back.
            </p>
            <p>
              Comments save automatically when posted. Export feedback to share with your editor, or
              ask Codex to read this studio’s feedback file. New cuts keep the older comments
              intact.
            </p>
            <p className="subtle">
              This studio runs on this Mac. Moment links work while it’s running here; they are not
              public review links.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function ProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="New project" onClose={onClose} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onCreated(
              await api<Project>('/projects', {
                method: 'POST',
                body: JSON.stringify({ name, description }),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          Project name
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Product launch"
          />
        </label>
        <label>
          Description <span>Optional</span>
          <textarea
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function ProfileDialog({
  author,
  onSave,
  onClose,
}: {
  author: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(author);
  return (
    <Modal title="Reviewer name" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <label>
          Your name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="subtle">This name appears on new comments and replies.</p>
        <footer>
          <button className="primary" disabled={!name.trim()}>
            Save name
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function UploadDialog({
  project,
  onClose,
  onAdded,
}: {
  project: Project;
  onClose: () => void;
  onAdded: (a: Asset) => Promise<void>;
}) {
  const [mode, setMode] = useState<'file' | 'path'>('file'),
    [file, setFile] = useState<File | null>(null),
    [path, setPath] = useState(''),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let asset: Asset;
      if (mode === 'path')
        asset = await api<Asset>(`/projects/${project.id}/import`, {
          method: 'POST',
          body: JSON.stringify({ path, title, description }),
        });
      else {
        const data = new FormData();
        data.append('video', file!);
        data.append('title', title);
        data.append('description', description);
        asset = await new Promise<Asset>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `/api/projects/${project.id}/upload`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              const body = JSON.parse(xhr.responseText);
              xhr.status >= 200 && xhr.status < 300
                ? resolve(body)
                : reject(new Error(body.error || 'Upload failed.'));
            } catch {
              reject(new Error('The studio did not respond to the upload.'));
            }
          };
          xhr.onerror = () => reject(new Error('Upload interrupted. Please try again.'));
          xhr.send(data);
        });
      }
      await onAdded(asset);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function choose(f: File | undefined) {
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    }
  }
  return (
    <Modal title="Add a video" onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <p className="subtle">
          Add a new cut to {project.name}. Existing cuts and feedback stay in place.
        </p>
        <div className="import-tabs">
          <button
            type="button"
            className={mode === 'file' ? 'active' : ''}
            onClick={() => setMode('file')}
            disabled={busy}
          >
            Choose file
          </button>
          <button
            type="button"
            className={mode === 'path' ? 'active' : ''}
            onClick={() => setMode('path')}
            disabled={busy}
          >
            Link local file
          </button>
        </div>
        {mode === 'file' ? (
          <>
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".mp4,.m4v,.mov,.webm"
              aria-label="Choose video file"
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <button
              type="button"
              className="dropzone"
              disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) choose(e.dataTransfer.files[0]);
              }}
            >
              <Upload size={25} />
              <b>{file ? file.name : 'Drop a video here, or browse'}</b>
              <span>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : 'H.264 MP4 recommended · up to 8 GB'}
              </span>
            </button>
          </>
        ) : (
          <label>
            Full video path
            <input
              autoFocus
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/you/Movies/next-cut.mp4"
            />
            <small>Links the file in place without making a second copy.</small>
          </label>
        )}
        <label>
          Cut title
          <input
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 07 — Tighter opening"
          />
        </label>
        <label>
          What changed? <span>Optional</span>
          <textarea
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short note about this version"
          />
        </label>
        {busy && (
          <div className="upload-progress" role="status">
            <LoaderCircle size={16} className="spin" />
            {mode === 'file' && progress < 100
              ? `Copying video… ${progress}%`
              : 'Preparing your video…'}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || (mode === 'file' ? !file : !path.trim())}>
            {busy ? 'Adding…' : 'Add video'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
