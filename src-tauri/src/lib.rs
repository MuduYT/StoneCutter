use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Serialize)]
struct ProjectFileInfo {
    path: String,
    directory: String,
    name: String,
}

fn sanitize_project_name(name: &str) -> String {
    let mut out = String::new();
    for ch in name.trim().chars() {
        match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => out.push('-'),
            c if c.is_control() => out.push('-'),
            c => out.push(c),
        }
    }
    let cleaned = out.trim_matches(|c: char| c == '.' || c == ' ' || c == '-').to_string();
    if cleaned.is_empty() {
        "Untitled Project".to_string()
    } else {
        cleaned
    }
}

fn ensure_project_extension(path: PathBuf) -> PathBuf {
    if path.extension().and_then(|ext| ext.to_str()) == Some("stonecutter") {
        path
    } else {
        path.with_extension("stonecutter")
    }
}

#[tauri::command]
fn create_project_folder(parent_dir: String, project_name: String, document: String) -> Result<ProjectFileInfo, String> {
    let safe_name = sanitize_project_name(&project_name);
    let project_dir = Path::new(&parent_dir).join(&safe_name);
    if project_dir.exists() {
        return Err(format!("Projektordner existiert bereits: {}", project_dir.display()));
    }
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Projektordner konnte nicht erstellt werden: {e}"))?;
    fs::create_dir_all(project_dir.join("Media"))
        .map_err(|e| format!("Media-Ordner konnte nicht erstellt werden: {e}"))?;

    let project_path = ensure_project_extension(project_dir.join(&safe_name));
    fs::write(&project_path, document)
        .map_err(|e| format!("Projektdatei konnte nicht geschrieben werden: {e}"))?;

    Ok(ProjectFileInfo {
        path: project_path.to_string_lossy().to_string(),
        directory: project_dir.to_string_lossy().to_string(),
        name: safe_name,
    })
}

#[tauri::command]
fn save_project_file(project_path: String, document: String) -> Result<(), String> {
    let path = ensure_project_extension(PathBuf::from(project_path));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Projektordner konnte nicht erstellt werden: {e}"))?;
    }
    fs::write(&path, document)
        .map_err(|e| format!("Projektdatei konnte nicht gespeichert werden: {e}"))?;
    Ok(())
}

#[tauri::command]
fn load_project_file(project_path: String) -> Result<String, String> {
    fs::read_to_string(&project_path)
        .map_err(|e| format!("Projektdatei konnte nicht gelesen werden: {e}"))
}

#[derive(serde::Deserialize, Debug)]
struct ExportSegment {
    source_path: String,
    in_point: f64,
    out_point: f64,
    media_type: String, // "video" | "image" | "gap"
    #[serde(default = "default_track_mode")]
    track_mode: String, // "av" | "audio"
}

fn default_track_mode() -> String {
    "av".to_string()
}

fn build_ffmpeg_args(
    segments: &[ExportSegment],
    output_path: &str,
    width: u32,
    height: u32,
    include_audio: bool,
    crf: u32,
    preset: &str,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(), "error".to_string(),
    ];
    let mut filters: Vec<String> = Vec::new();
    let mut v_labels: Vec<String> = Vec::new();
    let mut a_labels: Vec<String> = Vec::new();
    let mut input_idx: usize = 0;
    let scale_filter = format!(
        "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30",
        w = width, h = height
    );

    for (i, seg) in segments.iter().enumerate() {
        let dur = (seg.out_point - seg.in_point).max(0.001);
        match seg.media_type.as_str() {
            "image" => {
                args.extend(["-loop".into(), "1".into(), "-t".into(), format!("{dur:.3}"), "-i".into(), seg.source_path.clone()]);
                filters.push(format!("[{input_idx}:v]{scale_filter},setpts=PTS-STARTPTS[v{i}]"));
                v_labels.push(format!("[v{i}]"));
                if include_audio {
                    filters.push(format!("aevalsrc=0:c=stereo:s=44100:d={dur:.3}[a{i}]"));
                    a_labels.push(format!("[a{i}]"));
                }
                input_idx += 1;
            }
            "gap" => {
                filters.push(format!("color=black:s={w}x{h}:r=30:d={dur:.3}[v{i}]", w = width, h = height));
                v_labels.push(format!("[v{i}]"));
                if include_audio {
                    filters.push(format!("aevalsrc=0:c=stereo:s=44100:d={dur:.3}[a{i}]"));
                    a_labels.push(format!("[a{i}]"));
                }
            }
            _ => {
                args.extend(["-i".into(), seg.source_path.clone()]);
                if seg.track_mode == "audio" {
                    filters.push(format!("color=black:s={w}x{h}:r=30:d={dur:.3}[v{i}]", w = width, h = height));
                } else {
                    filters.push(format!(
                        "[{input_idx}:v]trim=start={:.4}:end={:.4},setpts=PTS-STARTPTS,{scale_filter}[v{i}]",
                        seg.in_point, seg.out_point
                    ));
                }
                v_labels.push(format!("[v{i}]"));
                if include_audio {
                    filters.push(format!(
                        "[{input_idx}:a]atrim=start={:.4}:end={:.4},asetpts=PTS-STARTPTS[a{i}]",
                        seg.in_point, seg.out_point
                    ));
                    a_labels.push(format!("[a{i}]"));
                }
                input_idx += 1;
            }
        }
    }

    let n = segments.len();
    if include_audio {
        let concat_inputs = (0..n)
            .map(|i| format!("[v{i}][a{i}]"))
            .collect::<Vec<_>>()
            .join("");
        filters.push(format!("{concat_inputs}concat=n={n}:v=1:a=1[vout][aout]"));
        args.extend(["-filter_complex".into(), filters.join(";")]);
        args.extend(["-map".into(), "[vout]".into(), "-map".into(), "[aout]".into()]);
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    } else {
        let v_in = v_labels.join("");
        filters.push(format!("{v_in}concat=n={n}:v=1:a=0[vout]"));
        args.extend(["-filter_complex".into(), filters.join(";")]);
        args.extend(["-map".into(), "[vout]".into()]);
    }

    args.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), preset.to_string(),
        "-crf".into(), crf.to_string(),
        "-pix_fmt".into(), "yuv420p".into(),
        "-movflags".into(), "+faststart".into(),
        "-y".into(),
        output_path.to_string(),
    ]);

    args
}

#[tauri::command]
fn export_video(
    segments: Vec<ExportSegment>,
    output_path: String,
    width: u32,
    height: u32,
    crf: u32,
    preset: String,
) -> Result<String, String> {
    if segments.is_empty() {
        return Err("Keine Clips auf der Timeline.".to_string());
    }

    // Try with audio first
    let args = build_ffmpeg_args(&segments, &output_path, width, height, true, crf, &preset);
    let run = Command::new("ffmpeg").args(&args).output();

    match run {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err("FFmpeg nicht gefunden. Bitte FFmpeg installieren und zum PATH hinzufügen.\nDownload: https://ffmpeg.org/download.html".to_string());
        }
        Err(e) => return Err(format!("FFmpeg-Startfehler: {e}")),
        Ok(out) if out.status.success() => return Ok(output_path),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let no_audio = stderr.contains("no such stream")
                || stderr.contains("does not contain")
                || stderr.contains("audio stream")
                || stderr.contains("Invalid audio");

            if no_audio {
                // Retry without audio
                let args2 = build_ffmpeg_args(&segments, &output_path, width, height, false, crf, &preset);
                let run2 = Command::new("ffmpeg").args(&args2).output()
                    .map_err(|e| format!("FFmpeg-Fehler: {e}"))?;

                if run2.status.success() {
                    return Ok(format!("{output_path}|no_audio"));
                }
                let stderr2 = String::from_utf8_lossy(&run2.stderr);
                let tail = stderr2.len().saturating_sub(800);
                return Err(format!("FFmpeg-Fehler (kein Audio):\n{}", &stderr2[tail..]));
            }

            let tail = stderr.len().saturating_sub(800);
            Err(format!("FFmpeg-Fehler:\n{}", &stderr[tail..]))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      export_video,
      create_project_folder,
      save_project_file,
      load_project_file,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
