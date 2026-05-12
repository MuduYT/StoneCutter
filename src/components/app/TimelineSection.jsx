import { Timeline } from "../Timeline.jsx";

export function TimelineSection({
  className,
  totalEnd,
  timelineTime,
  isTimelinePlaying,
  showSettings,
  historySizes,
  snapEnabled,
  muted,
  volume,
  pxPerSec,
  clips,
  clipsByTrack,
  activeClip,
  tracks,
  totalWidth,
  playheadX,
  interaction,
  activeClipId,
  selectedClipIds,
  draggingIds,
  dropTargetTrackId,
  trackMoveTargetIds,
  trackMovePreview,
  thumbsMap,
  videos,
  videoDurations,
  peaksMap,
  editingTrackId,
  dragOver,
  dropZoneTrackMode,
  scrubTooltip,
  selectedKeyframe,
  onSelectKeyframe,
  onBeginKeyframeDrag,
  onBeginVolumeKeyframeDrag,
  onAddVolumeKeyframe,
  fadeDragRef,
  volumeLineDragRef,
  createHistorySnapshot,
  getAutoTrackZoneTop,
  DEFAULT_TRACK_HEIGHT,
  setSnapEnabled,
  setShowSettings,
  setMuted,
  setVolume,
  setPxPerSec,
  setEditingTrackId,
  seekToTime,
  handlePlay,
  stepBack,
  stepFwd,
  splitAtPlayhead,
  undo,
  redo,
  handleTimelineDragEnter,
  handleTimelineDragOver,
  handleTimelineDragLeave,
  handleTimelineDrop,
  setTimelinePlayheadRef,
  setTracksContentRef,
  setTrackHeadersListRef,
  handleTracksMouseDown,
  handleTracksScroll,
  handlePlayheadMouseDown,
  handleClipMouseDown,
  handleCrossfadeMouseDown,
  handleClipContextMenu,
  handleTrimMouseDown,
  handleUpdateTrack,
  handleTrackResizeMouseDown,
  marqueeBox,
  snapIndicatorTime,
  formatTime,
  formatTC,
  Icon,
}) {
  return (
    <section
      className={className}
      onDragEnter={handleTimelineDragEnter}
      onDragOver={handleTimelineDragOver}
      onDragLeave={handleTimelineDragLeave}
      onDrop={handleTimelineDrop}
    >
      <div className="timeline-toolbar">
        <div className="tb-group">
          <button
            className="tb-btn"
            onClick={() => seekToTime(0)}
            title="Zum Anfang (Home)"
          >
            <Icon.SkipStart />
          </button>
          <button className="tb-btn" onClick={stepBack} title="1s zurueck (Left)">
            <Icon.StepBack />
          </button>
          <button className="tb-btn play" onClick={handlePlay} title="Play/Pause (Space)">
            {isTimelinePlaying ? <Icon.Pause /> : <Icon.Play />}
          </button>
          <button className="tb-btn" onClick={stepFwd} title="1s vor (Right)">
            <Icon.StepFwd />
          </button>
          <button
            className="tb-btn"
            onClick={() => seekToTime(totalEnd)}
            title="Zum Ende (End)"
          >
            <Icon.SkipEnd />
          </button>
        </div>

        <div className="tb-timecode">
          <span className="tc-current">{formatTC(timelineTime)}</span>
          <span className="tc-sep">/</span>
          <span className="tc-total">{formatTC(totalEnd)}</span>
        </div>

        <div className="tb-group">
          <button
            className="tb-btn"
            onClick={splitAtPlayhead}
            title="Am Playhead teilen (S)"
          >
            <Icon.Cut />
          </button>
          <button
            className="tb-btn"
            onClick={undo}
            title="Rueckgaengig (Strg+Z)"
            disabled={historySizes.past === 0}
          >
            <Icon.Undo />
          </button>
          <button
            className="tb-btn"
            onClick={redo}
            title="Wiederholen (Strg+Y)"
            disabled={historySizes.future === 0}
          >
            <Icon.Redo />
          </button>
        </div>

        <div className="tb-spacer" />

        <button
          className={`tb-btn toggle ${snapEnabled ? "on" : ""}`}
          onClick={() => setSnapEnabled((value) => !value)}
          title="Magnet-Snap (N)"
        >
          <Icon.Magnet />
        </button>

        <button
          className={`tb-btn ${showSettings ? "active" : ""}`}
          onClick={() => setShowSettings((value) => !value)}
          title="Einstellungen"
        >
          <Icon.Settings />
        </button>

        <div className="tb-group volume">
          <button
            className="tb-btn"
            onClick={() => setMuted((value) => !value)}
            title={muted ? "Stumm aufheben" : "Stummschalten"}
          >
            {muted || volume === 0 ? <Icon.Mute /> : <Icon.Volume />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            onChange={(e) => {
              const nextVolume = parseFloat(e.target.value);
              setVolume(nextVolume);
              if (nextVolume > 0) setMuted(false);
            }}
            className="vol-slider"
            title="Lautstaerke"
          />
        </div>

        <div className="tb-group zoom">
          <span className="tb-label">Zoom</span>
          <input
            type="range"
            min="10"
            max="120"
            step="2"
            value={pxPerSec}
            onChange={(e) => setPxPerSec(parseInt(e.target.value, 10))}
            className="zoom-slider"
            title="Zoom (px/s)"
          />
        </div>
      </div>

      <Timeline
        tracks={tracks}
        clips={clips}
        clipsByTrack={clipsByTrack}
        pxPerSec={pxPerSec}
        totalWidth={totalWidth}
        totalEnd={totalEnd}
        playheadX={playheadX}
        interaction={interaction}
        activeClipId={activeClipId}
        selectedClipIds={selectedClipIds}
        draggingIds={draggingIds}
        dropTargetTrackId={dropTargetTrackId}
        trackMoveTargetIds={trackMoveTargetIds}
        trackMovePreview={trackMovePreview}
        thumbsMap={thumbsMap}
        videos={videos}
        videoDurations={videoDurations}
        peaksMap={peaksMap}
        editingTrackId={editingTrackId}
        dragOver={dragOver}
        dropZoneTrackMode={dropZoneTrackMode}
        formatTime={formatTime}
        formatTC={formatTC}
        scrubTooltip={scrubTooltip}
        selectedKeyframe={selectedKeyframe}
        onSelectKeyframe={onSelectKeyframe}
        onBeginKeyframeDrag={onBeginKeyframeDrag}
        onBeginVolumeKeyframeDrag={onBeginVolumeKeyframeDrag}
        onAddVolumeKeyframe={onAddVolumeKeyframe}
        setTimelinePlayheadRef={setTimelinePlayheadRef}
        setTracksContentRef={setTracksContentRef}
        setTrackHeadersListRef={setTrackHeadersListRef}
        handleTracksMouseDown={handleTracksMouseDown}
        handleTracksScroll={handleTracksScroll}
        handlePlayheadMouseDown={handlePlayheadMouseDown}
        handleClipMouseDown={handleClipMouseDown}
        handleCrossfadeMouseDown={handleCrossfadeMouseDown}
        handleClipContextMenu={handleClipContextMenu}
        handleTrimMouseDown={handleTrimMouseDown}
        handleUpdateTrack={handleUpdateTrack}
        handleTrackResizeMouseDown={handleTrackResizeMouseDown}
        marqueeBox={marqueeBox}
        snapIndicatorTime={snapIndicatorTime}
        setEditingTrackId={setEditingTrackId}
        fadeDragRef={fadeDragRef}
        volumeLineDragRef={volumeLineDragRef}
        createHistorySnapshot={createHistorySnapshot}
        DEFAULT_TRACK_HEIGHT={DEFAULT_TRACK_HEIGHT}
        getAutoTrackZoneTop={getAutoTrackZoneTop}
        Icon={Icon}
      />

      <div className="status-bar">
        <div className="status-left">
          <span className="status-item">
            <span className="status-label">Clips:</span> {clips.length}
          </span>
          <span className="status-item">
            <span className="status-label">Laenge:</span> {formatTC(totalEnd)}
          </span>
          {activeClip && (
            <span className="status-item">
              <span className="status-label">Auswahl:</span> {activeClip.name} (
              {formatTime(activeClip.outPoint - activeClip.inPoint)})
            </span>
          )}
        </div>
        <div className="status-right">
          <span className="status-item">
            <span className="status-label">Snap:</span>{" "}
            {snapEnabled ? "Ein (N)" : "Aus (N)"}
          </span>
          <span className="status-item">
            <span className="status-label">Zoom:</span> {pxPerSec}px/s
          </span>
          <div className="kbd-hints">
            <span className="kbd-group"><kbd>Space</kbd> Play</span>
            <span className="kbd-group"><kbd>←→</kbd> Frame</span>
            <span className="kbd-sep">·</span>
            <span className="kbd-group"><kbd>S</kbd> Split</span>
            <span className="kbd-group"><kbd>Del</kbd></span>
            <span className="kbd-sep">·</span>
            <span className="kbd-group"><kbd>Strg+Z</kbd>/<kbd>Strg+Y</kbd></span>
            <span className="kbd-sep">·</span>
            <span className="kbd-group"><kbd>Strg+Del</kbd> Ripple</span>
            <span className="kbd-sep">·</span>
            <span className="kbd-group"><kbd>Strg+C/X/V</kbd></span>
            <span className="kbd-group"><kbd>Strg+D</kbd> Dup</span>
            <span className="kbd-sep">·</span>
            <span className="kbd-group"><kbd>N</kbd> Snap</span>
            <span className="kbd-group"><kbd>Shift</kbd></span>
            <span className="kbd-group"><kbd>Alt+Drag</kbd> Klon</span>
            <span className="kbd-group"><kbd>Strg+Shift+L</kbd> Unlink</span>
          </div>
        </div>
      </div>
    </section>
  );
}
