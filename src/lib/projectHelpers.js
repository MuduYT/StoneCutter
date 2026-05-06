import {
  buildProjectDocument,
  createEmptyProjectState,
  hydrateProjectState,
  resolveProjectMediaPath,
  sanitizeProjectName,
} from "./project.js";

const isTauri = "__TAURI_INTERNALS__" in window;

export async function createProjectDocument(newProjectName) {
  const name = sanitizeProjectName(newProjectName);
  return JSON.stringify(
    buildProjectDocument(createEmptyProjectState(name)),
    null,
    2,
  );
}

export async function createProjectFolder(parentDir, projectName, document) {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke("create_project_folder", {
    parentDir,
    projectName,
    document,
  });
}

export async function loadProjectFile(projectPath) {
  if (!isTauri) return null;
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  const raw = await invoke("load_project_file", { projectPath });
  const directory = projectPath.replace(/[\\/][^\\/]+$/, "");
  const state = hydrateProjectState(raw, {
    resolveMediaPath: (mediaPath) =>
      resolveProjectMediaPath(directory, mediaPath),
    convertFileSrc,
  });
  return { state, directory };
}

export async function saveProjectFile(projectPath, document) {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_project_file", { projectPath, document });
}

export function buildProjectSnapshot(name, videos, clips, sourceRanges, videoDurations, tracks, timelineTime, settings, aspectRatio, pxPerSec, snapEnabled, volume, muted) {
  return buildProjectDocument({
    name,
    videos,
    clips,
    sourceRanges,
    videoDurations,
    tracks,
    timelineTime,
    settings,
    aspectRatio,
    pxPerSec,
    snapEnabled,
    volume,
    muted,
  });
}
