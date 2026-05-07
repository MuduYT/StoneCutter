export function TopBar({
  logoUrl,
  Icon,
  currentProject,
  editingProjectName,
  isProjectDirty,
  historySizes,
  isTauri,
  clipsLength,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onUndo,
  onRedo,
  onToggleSettings,
  onSaveProject,
  onExport,
  onBackToProjects,
}) {
  return (
    <nav className="topbar">
      <div className="topbar-brand">
        <img
          src={logoUrl}
          alt="StoneCutter"
          className="topbar-logo"
          draggable={false}
        />
        <span className="topbar-app-name">StoneCutter</span>
      </div>
      <div className="topbar-center">
        <div className="topbar-project-info">
          <button
            className="topbar-back-btn"
            onClick={onBackToProjects}
            title="Zurueck zur Projektuebersicht"
          >
            <Icon.ChevronRight />
          </button>
          <div className="topbar-project-details">
            {editingProjectName ? (
              <input
                type="text"
                className="topbar-project-name-input"
                defaultValue={currentProject?.name || "Untitled Project"}
                autoFocus
                onBlur={(e) => onCommitRename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.target.blur();
                  } else if (e.key === "Escape") {
                    onCancelRename();
                  }
                }}
              />
            ) : (
              <button
                className="topbar-project-name"
                onClick={onStartRename}
                title="Projekt umbenennen"
              >
                {currentProject?.name || "Untitled Project"}
                {isProjectDirty && <span className="topbar-save-indicator" />}
              </button>
            )}
            {currentProject?.path && (
              <div className="topbar-project-path" title={currentProject.path}>
                {currentProject.path}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="topbar-right">
        <button
          className="topbar-btn"
          onClick={onUndo}
          title="Rueckgaengig (Strg+Z)"
          disabled={historySizes.past === 0}
        >
          <Icon.Undo />
        </button>
        <button
          className="topbar-btn"
          onClick={onRedo}
          title="Wiederholen (Strg+Y)"
          disabled={historySizes.future === 0}
        >
          <Icon.Redo />
        </button>
        <div className="topbar-divider" />
        <button className="topbar-btn" onClick={onToggleSettings} title="Einstellungen">
          <Icon.Settings />
        </button>
        <div className="topbar-divider" />
        {isTauri && (
          <button
            className="topbar-btn"
            onClick={onSaveProject}
            title="Projekt speichern (Strg+S)"
            disabled={!currentProject?.path || !isProjectDirty}
          >
            <Icon.Save />
          </button>
        )}
        <button
          className="topbar-export-btn"
          onClick={onExport}
          title="Als MP4 exportieren"
          disabled={clipsLength === 0}
        >
          <Icon.Export /> Export
        </button>
      </div>
    </nav>
  );
}
