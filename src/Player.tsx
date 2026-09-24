import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  SkipBack,
  SkipForward,
  MessageSquarePlus,
  Link2,
} from 'lucide-react';
import type { Asset, Comment } from './types';
import { timecode } from './types';
export function Player({
  asset,
  comments,
  onComment,
  onTime,
  seekTarget,
}: {
  asset: Asset;
  comments: Comment[];
  onComment: (time: number) => void;
  onTime: (time: number) => void;
  seekTarget: { time: number; token: number } | null;
}) {
  const video = useRef<HTMLVideoElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(asset.duration),
    [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(0.8),
    [speed, setSpeed] = useState(1),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  const seek = (target: number) => {
    if (video.current) {
      const n = Math.max(0, Math.min(duration, target));
      video.current.currentTime = n;
      setTime(n);
      onTime(n);
    }
  };
  const toggle = () => {
    const v = video.current;
    if (v)
      v.paused
        ? v.play().catch(() => setError('Playback could not start. Try pressing play again.'))
        : v.pause();
  };
  const comment = () => {
    video.current?.pause();
    const at = video.current?.currentTime || 0;
    if (document.fullscreenElement) document.exitFullscreen().finally(() => onComment(at));
    else onComment(at);
  };
  useEffect(() => {
    if (seekTarget && video.current) {
      const v = video.current;
      const go = () => {
        v.currentTime = Math.max(0, Math.min(asset.duration, seekTarget.time));
        setTime(v.currentTime);
        onTime(v.currentTime);
      };
      if (v.readyState >= 1) go();
      else {
        v.addEventListener('loadedmetadata', go, { once: true });
        return () => v.removeEventListener('loadedmetadata', go);
      }
    }
  }, [seekTarget, asset.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable],dialog')) return;
      if (e.code === 'Space') {
        if (target.closest('button')) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek((video.current?.currentTime || 0) + (e.shiftKey ? 1 / asset.fps : 5));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek((video.current?.currentTime || 0) - (e.shiftKey ? 1 / asset.fps : 5));
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        comment();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [asset.id, duration, asset.fps, onComment]);
  async function copyLink() {
    const url = new URL(location.href);
    url.searchParams.set('cut', asset.id);
    url.searchParams.set('t', time.toFixed(2));
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link. You can copy the address from your browser.');
    }
  }
  return (
    <div className="player" ref={surface}>
      <div className="video-stage">
        <video
          ref={video}
          src={`/api/assets/${asset.id}/video`}
          poster={`/api/assets/${asset.id}/thumbnail`}
          playsInline
          preload="metadata"
          onClick={toggle}
          onLoadedMetadata={() => {
            const v = video.current!;
            setDuration(v.duration);
            v.volume = volume;
            v.playbackRate = speed;
          }}
          onTimeUpdate={() => {
            setTime(video.current!.currentTime);
            onTime(video.current!.currentTime);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() =>
            setError(
              'This video could not load. Check that the original file is still available, or add an H.264 MP4 preview.',
            )
          }
          aria-label={asset.title}
        />
        {!playing && !error && (
          <button className="big-play" onClick={toggle} aria-label="Play video">
            <Play fill="currentColor" size={28} />
          </button>
        )}
        {error && (
          <div className="video-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError('');
                video.current?.load();
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="playback">
        <div className="timeline">
          <input
            aria-label="Video playhead"
            type="range"
            min="0"
            max={duration || 1}
            step="0.01"
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ '--progress': `${(time / duration) * 100}%` } as React.CSSProperties}
          />
          <div className="markers">
            {comments
              .filter((c) => !c.parentId)
              .map((c) => (
                <button
                  key={c.id}
                  className={`marker ${c.kind} ${c.resolved ? 'resolved' : ''}`}
                  style={{
                    left: `${(c.time / duration) * 100}%`,
                    width: c.endTime
                      ? `max(8px, ${((c.endTime - c.time) / duration) * 100}%)`
                      : undefined,
                  }}
                  title={`${timecode(c.time)} ${c.body}`}
                  aria-label={`Jump to comment at ${timecode(c.time)}: ${c.body}`}
                  onClick={() => {
                    video.current?.pause();
                    seek(c.time);
                  }}
                />
              ))}
          </div>
        </div>
        <div className="playback-row">
          <div className="transport">
            <button
              className="icon-button"
              title="Back 5 seconds"
              aria-label="Back 5 seconds"
              onClick={() => seek(time - 5)}
            >
              <SkipBack size={17} />
            </button>
            <button
              className="icon-button play-button"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={toggle}
            >
              {playing ? <Pause size={19} /> : <Play size={19} />}
            </button>
            <button
              className="icon-button"
              aria-label="Forward 5 seconds"
              title="Forward 5 seconds"
              onClick={() => seek(time + 5)}
            >
              <SkipForward size={17} />
            </button>
            <span className="timecode">
              <b>{timecode(time, true)}</b>
              <span> / {timecode(duration)}</span>
            </span>
          </div>
          <div className="playback-options">
            <button
              className="icon-button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                setMuted(!muted);
                video.current!.muted = !muted;
              }}
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              className="volume"
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                const n = Number(e.target.value);
                setVolume(n);
                video.current!.volume = n;
              }}
            />
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(e) => {
                setSpeed(Number(e.target.value));
                video.current!.playbackRate = Number(e.target.value);
              }}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              title={copied ? 'Copied' : 'Copy link to this moment'}
              aria-label="Copy link to this moment"
              onClick={copyLink}
            >
              <Link2 size={18} />
            </button>
            <button
              className="icon-button"
              title="Fullscreen"
              aria-label="Fullscreen"
              onClick={() => surface.current?.requestFullscreen().catch(() => {})}
            >
              <Maximize size={18} />
            </button>
          </div>
          <button className="comment-button" aria-label="Add comment" onClick={comment}>
            <MessageSquarePlus size={16} /> Add comment <kbd>C</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
