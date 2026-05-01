use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // Inject commit hash + build date so the About panel + auto-updater
    // can identify the running app without bundling a separate metadata
    // file. Falls back to "none" / "unknown" outside a git checkout so
    // CI builds-from-tarball still compile.
    let commit = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "none".to_string());

    let build_date = format_build_date(SystemTime::now())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=NOMI_COMMIT={commit}");
    println!("cargo:rustc-env=NOMI_BUILD_DATE={build_date}");
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs/heads");

    tauri_build::build()
}

// Minimal RFC3339 UTC formatter (YYYY-MM-DDTHH:MM:SSZ) so we don't
// pull in chrono just to stamp a build date. Same shape as the Go
// side keeps the JSON wire format identical.
fn format_build_date(now: SystemTime) -> Option<String> {
    let secs = now.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let (y, m, d, hh, mm, ss) = unix_to_ymd_hms(secs);
    Some(format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z"))
}

fn unix_to_ymd_hms(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let remainder = secs.rem_euclid(86_400) as u32;
    let hh = remainder / 3600;
    let mm = (remainder % 3600) / 60;
    let ss = remainder % 60;
    let (y, m, d) = days_to_ymd(days);
    (y, m, d, hh, mm, ss)
}

// Hinnant civil-from-days: convert days-since-1970-01-01 to (Y, M, D).
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}
