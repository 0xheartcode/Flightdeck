//! systemd runtime backend: tracks systemd service units via the `systemctl`
//! and `journalctl` commands (no extra dependency). Unlike the Docker backend,
//! the units to watch are listed explicitly (systemd has no labels), there is
//! no image or env, and redeploy/set_env do not apply.

use std::collections::HashMap;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::Sender;

use crate::docker::truncate;
use crate::protocol::{AgentMessage, LogLine};

const MAX_LINE_LEN: usize = 8192;

/// A systemd unit observed during a scan.
#[derive(Debug, Clone)]
pub struct Unit {
    pub name: String,
    pub state: String,
    pub description: String,
}

/// Map systemd ActiveState/SubState to the normalized service state on the wire.
pub fn map_state(active: &str, sub: &str) -> &'static str {
    match active {
        "active" => match sub {
            "exited" => "exited",
            _ => "running",
        },
        "activating" | "reloading" => "restarting",
        "deactivating" => "removing",
        "inactive" => "exited",
        "failed" => "dead",
        _ => "unknown",
    }
}

/// Parse `systemctl show` key=value lines into a lookup.
pub fn parse_show(output: &str) -> HashMap<String, String> {
    output
        .lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// Parse one `journalctl -o json` line into (timestamp ms, message), or None.
pub fn parse_journal_line(line: &str) -> Option<(i64, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let message = match v.get("MESSAGE")? {
        serde_json::Value::String(s) => s.clone(),
        // Binary messages come as an array of byte values.
        serde_json::Value::Array(a) => {
            let bytes: Vec<u8> = a
                .iter()
                .filter_map(|x| x.as_u64())
                .map(|b| b as u8)
                .collect();
            String::from_utf8_lossy(&bytes).into_owned()
        }
        _ => return None,
    };
    // __REALTIME_TIMESTAMP is microseconds since the epoch, as a string.
    let ts_us: i64 = v
        .get("__REALTIME_TIMESTAMP")
        .and_then(|x| x.as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    Some((ts_us / 1000, message))
}

/// Discover the configured units by querying each with `systemctl show`.
pub async fn discover(units: &[String]) -> Vec<Unit> {
    let mut found = Vec::new();
    for unit in units.iter().filter(|u| !u.is_empty()) {
        let output = Command::new("systemctl")
            .args([
                "show",
                unit,
                "--property=ActiveState,SubState,Description,LoadState",
            ])
            .output()
            .await;
        let Ok(output) = output else { continue };
        if !output.status.success() {
            continue;
        }
        let props = parse_show(&String::from_utf8_lossy(&output.stdout));
        // Skip a unit systemd does not know about.
        if props.get("LoadState").map(String::as_str) == Some("not-found") {
            continue;
        }
        let active = props.get("ActiveState").map(String::as_str).unwrap_or("");
        let sub = props.get("SubState").map(String::as_str).unwrap_or("");
        found.push(Unit {
            name: unit.clone(),
            state: map_state(active, sub).to_string(),
            description: props.get("Description").cloned().unwrap_or_default(),
        });
    }
    found
}

/// Follow a unit's journal and forward each line to the control plane.
pub async fn stream_logs(unit: String, service_id: String, tx: Sender<AgentMessage>) {
    let mut child = match Command::new("journalctl")
        .args(["-u", &unit, "-f", "-n", "20", "-o", "json", "--no-pager"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            tracing::warn!(unit = %unit, error = %err, "journalctl spawn failed");
            return;
        }
    };
    let Some(stdout) = child.stdout.take() else {
        return;
    };
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(raw)) = lines.next_line().await {
        if let Some((ts, message)) = parse_journal_line(&raw) {
            if message.is_empty() {
                continue;
            }
            let _ = tx.try_send(AgentMessage::log(LogLine {
                service_id: service_id.clone(),
                stream: "stdout",
                ts,
                line: truncate(&message, MAX_LINE_LEN),
            }));
        }
    }
    let _ = child.kill().await;
}

/// Restart a unit via `systemctl restart`.
pub async fn restart(unit: &str) -> anyhow::Result<()> {
    let output = Command::new("systemctl")
        .args(["restart", unit])
        .output()
        .await?;
    if output.status.success() {
        Ok(())
    } else {
        anyhow::bail!(
            "systemctl restart failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{map_state, parse_journal_line, parse_show};

    #[test]
    fn maps_systemd_states() {
        assert_eq!(map_state("active", "running"), "running");
        assert_eq!(map_state("active", "exited"), "exited");
        assert_eq!(map_state("activating", "start"), "restarting");
        assert_eq!(map_state("failed", "failed"), "dead");
        assert_eq!(map_state("inactive", "dead"), "exited");
        assert_eq!(map_state("whatever", "x"), "unknown");
    }

    #[test]
    fn parses_show_properties() {
        let props = parse_show("ActiveState=active\nSubState=running\nDescription=My App");
        assert_eq!(props.get("ActiveState").unwrap(), "active");
        assert_eq!(props.get("Description").unwrap(), "My App");
    }

    #[test]
    fn parses_a_journal_line() {
        let line = r#"{"MESSAGE":"hello","__REALTIME_TIMESTAMP":"1700000000000000"}"#;
        assert_eq!(
            parse_journal_line(line),
            Some((1_700_000_000_000, "hello".to_string()))
        );
    }

    #[test]
    fn parses_a_binary_journal_message() {
        let line = r#"{"MESSAGE":[104,105],"__REALTIME_TIMESTAMP":"1000"}"#;
        assert_eq!(parse_journal_line(line), Some((1, "hi".to_string())));
    }

    #[test]
    fn rejects_a_non_json_journal_line() {
        assert_eq!(parse_journal_line("not json"), None);
    }
}
