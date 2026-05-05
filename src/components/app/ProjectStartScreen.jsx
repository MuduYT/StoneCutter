export function ProjectStartScreen({
  logoUrl,
  Icon,
  recentProjects,
  projectStatus,
  showNewProjectDialog,
  newProjectName,
  onNewProjectNameChange,
  onCreateProject,
  onOpenProject,
  onOpenProjectPath,
  onClearRecentProjects,
  onShowNewProjectDialog,
  onCloseNewProjectDialog,
  isTauri,
}) {
  return (
    <div className="app project-start-app">
      <div className="project-start-shell">
        <img
          src={logoUrl}
          alt="StoneCutter"
          className="project-start-logo"
          draggable={false}
        />
        <h1>Willkommen zu StoneCutter</h1>
        <div className="project-start-actions">
          <button
            className="project-primary-action"
            onClick={onShowNewProjectDialog}
          >
            <Icon.Plus /> Neues Projekt
          </button>
          <button
            className="project-secondary-action"
            onClick={onOpenProject}
            disabled={!isTauri}
          >
            <Icon.FolderOpen /> Projekt oeffnen
          </button>
        </div>

        <section className="recent-projects-panel">
          <div className="recent-projects-header">
            <h2>Zuletzt benutzt</h2>
            {recentProjects.length > 0 && (
              <button className="recent-clear-btn" onClick={onClearRecentProjects}>
                Leeren
              </button>
            )}
          </div>
          {recentProjects.length === 0 ? (
            <div className="recent-empty">Noch keine Projekte geoeffnet.</div>
          ) : (
            <div className="recent-project-list">
              {recentProjects.map((project) => (
                <button
                  key={project.path}
                  className="recent-project-item"
                  onClick={() => onOpenProjectPath(project.path)}
                  title={project.path}
                >
                  <span className="recent-project-icon">
                    <Icon.File />
                  </span>
                  <span className="recent-project-info">
                    <strong>{project.name}</strong>
                    <span>{project.path}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {projectStatus && (
          <div className={`project-status ${projectStatus.ok ? "ok" : "err"}`}>
            {projectStatus.msg}
          </div>
        )}
      </div>

      {showNewProjectDialog && (
        <div className="settings-overlay" onClick={onCloseNewProjectDialog}>
          <div
            className="settings-panel project-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-header">
              <h3>
                <Icon.Plus /> Neues Projekt
              </h3>
              <button className="settings-close" onClick={onCloseNewProjectDialog}>
                x
              </button>
            </div>
            <div className="settings-body">
              <label className="project-name-field">
                <span>Projektname</span>
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => onNewProjectNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCreateProject();
                  }}
                />
              </label>
              <p className="settings-hint">
                StoneCutter erstellt einen Projektordner mit einer
                `.stonecutter`-Projektdatei.
              </p>
              <button className="export-start-btn" onClick={onCreateProject}>
                <Icon.FolderOpen /> Speicherort waehlen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
