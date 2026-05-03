use std::collections::HashSet;
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
    let cleaned = out
        .trim_matches(|c: char| c == '.' || c == ' ' || c == '-')
        .to_string();
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

fn sanitize_file_component(value: &str, fallback: &str) -> String {
    let mut out = String::new();
    for ch in value.trim().chars() {
        match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => out.push('-'),
            c if c.is_control() => out.push('-'),
            c => out.push(c),
        }
    }
    let cleaned = out
        .trim_matches(|c: char| c == '.' || c == ' ' || c == '-')
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[1] == b':'
        && bytes[0].is_ascii_alphabetic()
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn is_absolute_media_path(path: &str) -> bool {
    Path::new(path).is_absolute()
        || is_windows_absolute_path(path)
        || path.starts_with("\\\\")
        || path.starts_with("//")
}

fn is_project_media_relative_path(path: &str) -> bool {
    if is_absolute_media_path(path) {
        return false;
    }
    let normalized = path.replace('\\', "/");
    normalized == "Media" || normalized.starts_with("Media/")
}

fn resolve_media_source_path(project_dir: &Path, raw_path: &str) -> Option<PathBuf> {
    if is_absolute_media_path(raw_path) {
        Some(PathBuf::from(raw_path))
    } else if is_project_media_relative_path(raw_path) {
        Some(project_dir.join(raw_path))
    } else {
        None
    }
}

fn split_name_extension(file_name: &str) -> (String, String) {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let safe_stem = sanitize_file_component(stem, "media");
    let safe_extension = sanitize_file_component(extension, "");
    (safe_stem, safe_extension)
}

fn unique_managed_media_file_name(
    media_id: &str,
    source_file_name: &str,
    used_names: &mut HashSet<String>,
) -> String {
    let safe_id = sanitize_file_component(media_id, "");
    let safe_source = sanitize_file_component(source_file_name, "media");
    let expected_prefix = if safe_id.is_empty() {
        String::new()
    } else {
        format!("{safe_id}-")
    };
    let prefixed = if expected_prefix.is_empty() || safe_source.starts_with(&expected_prefix) {
        safe_source
    } else {
        format!("{expected_prefix}{safe_source}")
    };
    let (stem, extension) = split_name_extension(&prefixed);
    let mut counter = 1;
    loop {
        let suffix = if counter == 1 {
            String::new()
        } else {
            format!("-{counter}")
        };
        let candidate = if extension.is_empty() {
            format!("{stem}{suffix}")
        } else {
            format!("{stem}{suffix}.{extension}")
        };
        if used_names.insert(candidate.clone()) {
            return candidate;
        }
        counter += 1;
    }
}

fn paths_point_to_same_file(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn prepare_project_document_for_save(
    project_path: &Path,
    document: &str,
) -> Result<String, String> {
    let mut value: serde_json::Value = serde_json::from_str(document)
        .map_err(|e| format!("Projektdatei enthaelt kein gueltiges JSON: {e}"))?;
    let Some(project_dir) = project_path.parent() else {
        return Ok(document.to_string());
    };
    let media_dir = project_dir.join("Media");
    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Media-Ordner konnte nicht erstellt werden: {e}"))?;

    let Some(media_items) = value
        .get_mut("media")
        .and_then(|media| media.as_array_mut())
    else {
        return serde_json::to_string_pretty(&value)
            .map_err(|e| format!("Projektdatei konnte nicht serialisiert werden: {e}"));
    };

    let mut used_names = HashSet::new();
    for item in media_items.iter_mut() {
        let Some(media) = item.as_object_mut() else {
            continue;
        };
        let Some(raw_path) = media
            .get("path")
            .and_then(|path| path.as_str())
            .map(str::to_string)
        else {
            continue;
        };
        if raw_path.trim().is_empty() {
            continue;
        }

        let Some(source_path) = resolve_media_source_path(project_dir, &raw_path) else {
            continue;
        };
        if !source_path.is_file() {
            continue;
        }

        let source_file_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .or_else(|| media.get("name").and_then(|name| name.as_str()))
            .unwrap_or("media");
        let media_id = media.get("id").and_then(|id| id.as_str()).unwrap_or("");
        let managed_file_name =
            unique_managed_media_file_name(media_id, source_file_name, &mut used_names);
        let destination = media_dir.join(&managed_file_name);

        if !paths_point_to_same_file(&source_path, &destination) {
            fs::copy(&source_path, &destination).map_err(|e| {
                format!(
                    "Medium konnte nicht in den Projektordner kopiert werden ({}): {e}",
                    source_path.display()
                )
            })?;
        }

        if !media.contains_key("originalPath") && !is_project_media_relative_path(&raw_path) {
            media.insert(
                "originalPath".to_string(),
                serde_json::Value::String(raw_path),
            );
        }
        let relative_path = Path::new("Media")
            .join(managed_file_name)
            .to_string_lossy()
            .to_string();
        media.insert("path".to_string(), serde_json::Value::String(relative_path));
    }

    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Projektdatei konnte nicht serialisiert werden: {e}"))
}

#[tauri::command]
fn create_project_folder(
    parent_dir: String,
    project_name: String,
    document: String,
) -> Result<ProjectFileInfo, String> {
    let safe_name = sanitize_project_name(&project_name);
    let project_dir = Path::new(&parent_dir).join(&safe_name);
    if project_dir.exists() {
        return Err(format!(
            "Projektordner existiert bereits: {}",
            project_dir.display()
        ));
    }
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Projektordner konnte nicht erstellt werden: {e}"))?;
    fs::create_dir_all(project_dir.join("Media"))
        .map_err(|e| format!("Media-Ordner konnte nicht erstellt werden: {e}"))?;

    let project_path = ensure_project_extension(project_dir.join(&safe_name));
    let document = prepare_project_document_for_save(&project_path, &document)?;
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
    let document = prepare_project_document_for_save(&path, &document)?;
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
    media_type: String, // "video" | "image" | "audio" | "gap"
    #[serde(default = "default_track_mode")]
    track_mode: String, // "video" | "audio" | "av"
    #[serde(default)]
    start_time: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    has_video: bool,
    #[serde(default)]
    has_audio: bool,

    #[serde(default = "default_volume")]
    volume: f64,
    #[serde(default)]
    fade_in: f64,
    #[serde(default)]
    fade_out: f64,
    #[serde(default)]
    position_x: f64,
    #[serde(default)]
    position_y: f64,
    #[serde(default = "default_scale")]
    scale: f64,
    #[serde(default)]
    rotation: f64,
    #[serde(default = "default_opacity")]
    opacity: f64,
    #[serde(default)]
    brightness: f64,
    #[serde(default)]
    contrast: f64,
    #[serde(default)]
    saturation: f64,
    #[serde(default)]
    flip_h: bool,
    #[serde(default)]
    flip_v: bool,
}

fn default_track_mode() -> String {
    "av".to_string()
}

fn default_volume() -> f64 {
    1.0
}

fn default_scale() -> f64 {
    100.0
}

fn default_opacity() -> f64 {
    100.0
}

impl ExportSegment {
    fn start(&self) -> f64 {
        if self.start_time.is_finite() {
            self.start_time.max(0.0)
        } else {
            0.0
        }
    }

    fn duration(&self) -> f64 {
        if self.duration.is_finite() && self.duration > 0.0 {
            self.duration.max(0.001)
        } else {
            (self.out_point - self.in_point).max(0.001)
        }
    }

    fn end(&self) -> f64 {
        self.start() + self.duration()
    }

    fn wants_video(&self) -> bool {
        self.media_type != "audio"
            && self.media_type != "gap"
            && self.track_mode != "audio"
            && (self.has_video || !self.has_audio)
    }

    fn wants_audio(&self) -> bool {
        self.has_audio || (self.track_mode == "av" && self.media_type == "video")
    }
}

fn clamp_f64(value: f64, fallback: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.max(min).min(max)
    } else {
        fallback
    }
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
        "-loglevel".to_string(),
        "error".to_string(),
    ];
    let mut filters: Vec<String> = Vec::new();
    let mut a_labels: Vec<String> = Vec::new();
    let mut input_indices: Vec<Option<usize>> = Vec::new();
    let mut input_idx: usize = 0;
    let total_duration = segments
        .iter()
        .map(ExportSegment::end)
        .fold(0.0, f64::max)
        .max(0.001);

    for seg in segments {
        if seg.media_type == "gap" || seg.source_path.trim().is_empty() {
            input_indices.push(None);
            continue;
        }

        if seg.media_type == "image" {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-t".into(),
                format!("{:.3}", seg.duration()),
                "-i".into(),
                seg.source_path.clone(),
            ]);
        } else {
            args.extend(["-i".into(), seg.source_path.clone()]);
        }
        input_indices.push(Some(input_idx));
        input_idx += 1;
    }

    filters.push(format!(
        "color=black:s={w}x{h}:r=30:d={dur:.3}[base0]",
        w = width,
        h = height,
        dur = total_duration
    ));

    let mut overlay_label = "base0".to_string();
    let mut overlay_count = 0usize;
    for (i, seg) in segments.iter().enumerate() {
        if !seg.wants_video() {
            continue;
        }
        let Some(source_idx) = input_indices.get(i).and_then(|idx| *idx) else {
            continue;
        };

        let dur = seg.duration();
        let scale_factor = clamp_f64(seg.scale / 100.0, 1.0, 0.01, 4.0);
        let target_w = ((width as f64 * scale_factor).round() as u32).max(1);
        let target_h = ((height as f64 * scale_factor).round() as u32).max(1);
        let mut ops = vec![format!(
            "scale={target_w}:{target_h}:force_original_aspect_ratio=decrease"
        )];
        ops.push("format=rgba".to_string());
        if seg.flip_h {
            ops.push("hflip".to_string());
        }
        if seg.flip_v {
            ops.push("vflip".to_string());
        }
        let brightness = clamp_f64(seg.brightness / 100.0, 0.0, -1.0, 1.0);
        let contrast = clamp_f64(1.0 + seg.contrast / 100.0, 1.0, 0.0, 2.0);
        let saturation = clamp_f64(1.0 + seg.saturation / 100.0, 1.0, 0.0, 2.0);
        if brightness.abs() > 0.0001
            || (contrast - 1.0).abs() > 0.0001
            || (saturation - 1.0).abs() > 0.0001
        {
            ops.push(format!(
                "eq=brightness={brightness:.4}:contrast={contrast:.4}:saturation={saturation:.4}"
            ));
        }
        let radians = clamp_f64(seg.rotation, 0.0, -360.0, 360.0).to_radians();
        if radians.abs() > 0.0001 {
            ops.push(format!(
                "rotate={radians:.6}:c=none:ow=rotw({radians:.6}):oh=roth({radians:.6})"
            ));
        }
        let fade_in = clamp_f64(seg.fade_in, 0.0, 0.0, dur * 0.95);
        let fade_out = clamp_f64(seg.fade_out, 0.0, 0.0, dur * 0.95);
        if fade_in > 0.0001 {
            ops.push(format!("fade=t=in:st=0:d={fade_in:.4}:alpha=1"));
        }
        if fade_out > 0.0001 {
            ops.push(format!(
                "fade=t=out:st={:.4}:d={fade_out:.4}:alpha=1",
                (dur - fade_out).max(0.0)
            ));
        }
        let opacity = clamp_f64(seg.opacity / 100.0, 1.0, 0.0, 1.0);
        if opacity < 0.9999 {
            ops.push(format!("colorchannelmixer=aa={opacity:.4}"));
        }
        ops.push(format!("setpts=PTS+{:.4}/TB", seg.start()));

        let source = if seg.media_type == "image" {
            format!("[{source_idx}:v]setpts=PTS-STARTPTS")
        } else {
            format!(
                "[{source_idx}:v]trim=start={:.4}:end={:.4},setpts=PTS-STARTPTS",
                seg.in_point, seg.out_point
            )
        };
        filters.push(format!("{source},{}[v{i}]", ops.join(",")));

        overlay_count += 1;
        let next_label = format!("base{overlay_count}");
        let x_expr = format!("(W-w)/2{:+.3}", seg.position_x);
        let y_expr = format!("(H-h)/2{:+.3}", seg.position_y);
        filters.push(format!(
            "[{overlay_label}][v{i}]overlay=x='{x_expr}':y='{y_expr}':enable='between(t,{:.3},{:.3})':eof_action=pass:shortest=0[{next_label}]",
            seg.start(),
            seg.end()
        ));
        overlay_label = next_label;
    }

    if include_audio {
        for (i, seg) in segments.iter().enumerate() {
            if !seg.wants_audio() {
                continue;
            }
            let Some(source_idx) = input_indices.get(i).and_then(|idx| *idx) else {
                continue;
            };
            if seg.media_type == "image" || seg.media_type == "gap" {
                continue;
            }

            let dur = seg.duration();
            let volume = clamp_f64(seg.volume, 1.0, 0.0, 2.0);
            let fade_in = clamp_f64(seg.fade_in, 0.0, 0.0, dur * 0.95);
            let fade_out = clamp_f64(seg.fade_out, 0.0, 0.0, dur * 0.95);
            let delay_ms = (seg.start() * 1000.0).round().max(0.0);
            let mut ops = vec![
                format!(
                    "[{source_idx}:a]atrim=start={:.4}:end={:.4},asetpts=PTS-STARTPTS",
                    seg.in_point, seg.out_point
                ),
                "aresample=44100".to_string(),
                "aformat=channel_layouts=stereo".to_string(),
                format!("volume={volume:.4}"),
            ];
            if fade_in > 0.0001 {
                ops.push(format!("afade=t=in:st=0:d={fade_in:.4}"));
            }
            if fade_out > 0.0001 {
                ops.push(format!(
                    "afade=t=out:st={:.4}:d={fade_out:.4}",
                    (dur - fade_out).max(0.0)
                ));
            }
            ops.push(format!("adelay=delays={delay_ms:.0}:all=1"));
            ops.push("apad".to_string());
            ops.push(format!("atrim=0:{total_duration:.4}[a{i}]"));
            filters.push(ops.join(","));
            a_labels.push(format!("[a{i}]"));
        }
    }

    let video_out = overlay_label;
    if include_audio && !a_labels.is_empty() {
        filters.push(format!(
            "{}amix=inputs={}:duration=longest:normalize=0,atrim=0:{total_duration:.4}[aout]",
            a_labels.join(""),
            a_labels.len()
        ));
        args.extend(["-filter_complex".into(), filters.join(";")]);
        args.extend([
            "-map".into(),
            format!("[{video_out}]"),
            "-map".into(),
            "[aout]".into(),
        ]);
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    } else {
        args.extend(["-filter_complex".into(), filters.join(";")]);
        args.extend(["-map".into(), format!("[{video_out}]")]);
    }

    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        preset.to_string(),
        "-crf".into(),
        crf.to_string(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-y".into(),
        output_path.to_string(),
    ]);

    args
}

fn ffmpeg_error_looks_like_missing_audio(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("no such stream")
        || lower.contains("does not contain")
        || lower.contains("audio stream")
        || lower.contains("invalid audio")
        || stderr.contains("Stream specifier")
        || lower.contains("matches no streams")
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
            let no_audio = ffmpeg_error_looks_like_missing_audio(&stderr);

            if no_audio {
                // Retry without audio
                let args2 =
                    build_ffmpeg_args(&segments, &output_path, width, height, false, crf, &preset);
                let run2 = Command::new("ffmpeg")
                    .args(&args2)
                    .output()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn filter_complex(args: &[String]) -> String {
        let index = args
            .iter()
            .position(|arg| arg == "-filter_complex")
            .unwrap();
        args[index + 1].clone()
    }

    #[test]
    fn sanitizes_blank_project_names() {
        assert_eq!(sanitize_project_name("   "), "Untitled Project");
        assert_eq!(sanitize_project_name("---"), "Untitled Project");
    }

    #[test]
    fn save_preparation_copies_media_into_project_media_folder() {
        let unique = format!(
            "stonecutter-save-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let project_dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&project_dir).unwrap();
        let source_path = project_dir.join("source clip.mp4");
        fs::write(&source_path, b"media bytes").unwrap();
        let project_path = project_dir.join("Demo.stonecutter");
        let document = serde_json::json!({
            "app": "StoneCutter",
            "schemaVersion": 2,
            "project": { "name": "Demo" },
            "media": [{
                "id": "vid-1",
                "name": "source clip.mp4",
                "path": source_path.to_string_lossy(),
                "mediaType": "video"
            }],
            "timeline": { "clips": [], "playhead": 0 }
        })
        .to_string();

        let prepared = prepare_project_document_for_save(&project_path, &document).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&prepared).unwrap();
        let media = &parsed["media"][0];
        let managed_path = media["path"].as_str().unwrap();

        assert!(managed_path
            .replace('\\', "/")
            .starts_with("Media/vid-1-source clip.mp4"));
        assert_eq!(
            media["originalPath"].as_str().unwrap(),
            source_path.to_string_lossy()
        );
        assert_eq!(
            fs::read(project_dir.join(managed_path)).unwrap(),
            b"media bytes"
        );

        let prepared_again = prepare_project_document_for_save(&project_path, &prepared).unwrap();
        let parsed_again: serde_json::Value = serde_json::from_str(&prepared_again).unwrap();
        assert_eq!(parsed_again["media"][0]["path"], media["path"]);

        fs::remove_dir_all(project_dir).unwrap();
    }

    #[test]
    fn save_preparation_leaves_browser_only_media_paths_unchanged() {
        let unique = format!("stonecutter-browser-media-test-{}", std::process::id());
        let project_dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&project_dir).unwrap();
        let project_path = project_dir.join("Demo.stonecutter");
        let document = serde_json::json!({
            "app": "StoneCutter",
            "schemaVersion": 2,
            "project": { "name": "Demo" },
            "media": [{
                "id": "vid-1",
                "name": "browser.mp4",
                "path": "browser.mp4",
                "mediaType": "video"
            }],
            "timeline": { "clips": [], "playhead": 0 }
        })
        .to_string();

        let prepared = prepare_project_document_for_save(&project_path, &document).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&prepared).unwrap();
        assert_eq!(parsed["media"][0]["path"].as_str().unwrap(), "browser.mp4");
        assert!(parsed["media"][0].get("originalPath").is_none());

        fs::remove_dir_all(project_dir).unwrap();
    }

    fn test_segment(source_path: &str, media_type: &str, track_mode: &str) -> ExportSegment {
        ExportSegment {
            source_path: source_path.to_string(),
            in_point: 0.0,
            out_point: 1.0,
            media_type: media_type.to_string(),
            track_mode: track_mode.to_string(),
            start_time: 0.0,
            duration: 1.0,
            has_video: media_type != "audio" && media_type != "gap" && track_mode != "audio",
            has_audio: track_mode == "audio" || (track_mode == "av" && media_type == "video"),

            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            position_x: 0.0,
            position_y: 0.0,
            scale: 100.0,
            rotation: 0.0,
            opacity: 100.0,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            flip_h: false,
            flip_v: false,
        }
    }

    #[test]
    fn builds_gap_only_filter_without_real_inputs() {
        let segments = vec![
            test_segment("", "gap", "av"),
            ExportSegment {
                start_time: 1.0,
                duration: 2.0,
                out_point: 2.0,
                ..test_segment("", "gap", "av")
            },
        ];
        let args = build_ffmpeg_args(&segments, "out.mp4", 1920, 1080, true, 23, "fast");
        let filter = filter_complex(&args);

        assert!(!args.iter().any(|arg| arg == "-i"));
        assert!(filter.contains("color=black:s=1920x1080:r=30:d=3.000[base0]"));
        assert!(!filter.contains("concat="));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-map" && pair[1] == "[base0]"));
    }

    #[test]
    fn builds_audio_only_track_with_correct_audio_input_index() {
        let segments = vec![
            test_segment("", "gap", "av"),
            ExportSegment {
                source_path: "voice.wav".to_string(),
                in_point: 2.0,
                out_point: 4.5,
                start_time: 1.0,
                duration: 2.5,
                ..test_segment("voice.wav", "audio", "audio")
            },
        ];
        let args = build_ffmpeg_args(&segments, "out.mp4", 1280, 720, true, 23, "fast");
        let filter = filter_complex(&args);

        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-i" && pair[1] == "voice.wav"));
        assert!(filter.contains("color=black:s=1280x720:r=30:d=3.500[base0]"));
        assert!(filter.contains("[0:a]atrim=start=2.0000:end=4.5000,asetpts=PTS-STARTPTS"));
        assert!(filter.contains("adelay=delays=1000:all=1"));
        assert!(filter.contains("amix=inputs=1:duration=longest:normalize=0"));
    }

    #[test]
    fn builds_video_overlay_and_audio_mix_filters() {
        let segments = vec![
            ExportSegment {
                source_path: "overlay.png".to_string(),
                media_type: "image".to_string(),
                start_time: 1.0,
                duration: 2.0,
                out_point: 2.0,
                has_video: true,
                position_x: 100.0,
                position_y: -50.0,
                scale: 50.0,
                rotation: 15.0,
                opacity: 70.0,
                fade_in: 0.5,
                fade_out: 0.25,
                ..test_segment("overlay.png", "image", "video")
            },
            ExportSegment {
                source_path: "music.wav".to_string(),
                media_type: "audio".to_string(),
                track_mode: "audio".to_string(),
                start_time: 0.5,
                duration: 3.0,
                out_point: 3.0,
                has_video: false,
                has_audio: true,
                volume: 0.5,
                fade_in: 0.25,
                fade_out: 0.5,
                ..test_segment("music.wav", "audio", "audio")
            },
        ];
        let args = build_ffmpeg_args(&segments, "out.mp4", 1920, 1080, true, 18, "slow");
        let filter = filter_complex(&args);

        assert!(filter.contains("scale=960:540:force_original_aspect_ratio=decrease"));
        assert!(filter.contains("rotate=0.261799"));
        assert!(filter.contains("fade=t=in:st=0:d=0.5000:alpha=1"));
        assert!(filter.contains("colorchannelmixer=aa=0.7000"));
        assert!(filter.contains(
            "overlay=x='(W-w)/2+100.000':y='(H-h)/2-50.000':enable='between(t,1.000,3.000)'"
        ));
        assert!(filter.contains("volume=0.5000"));
        assert!(filter.contains("afade=t=out:st=2.5000:d=0.5000"));
    }

    #[test]
    fn detects_missing_audio_ffmpeg_errors() {
        assert!(ffmpeg_error_looks_like_missing_audio(
            "Stream specifier ':a' matches no streams."
        ));
        assert!(ffmpeg_error_looks_like_missing_audio(
            "Filtergraph error: matches no streams"
        ));
        assert!(ffmpeg_error_looks_like_missing_audio(
            "Invalid audio stream"
        ));
        assert!(!ffmpeg_error_looks_like_missing_audio("Permission denied"));
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
