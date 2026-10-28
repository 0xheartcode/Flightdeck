//! Docker/Podman API access via bollard. Talks to the Docker-compatible
//! socket, so it works against Docker or a rootless Podman socket unchanged.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use bollard::Docker;
use bollard::config::ContainerSummaryStateEnum;
use bollard::container::LogOutput;
use bollard::query_parameters::{ListContainersOptionsBuilder, LogsOptionsBuilder};
use futures_util::StreamExt;
use tokio::sync::mpsc::UnboundedSender;

use crate::protocol::{AgentMessage, LogLine};

/// A labelled container found during a discovery scan.
#[derive(Debug, Clone)]
pub struct Discovered {
    pub container_id: String,
    pub service_id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub created_at: i64,
}

pub fn connect(docker_host: Option<&str>) -> anyhow::Result<Docker> {
    let docker = match docker_host {
        Some(host) => {
            let path = host.strip_prefix("unix://").unwrap_or(host);
            Docker::connect_with_unix(path, 120, bollard::API_DEFAULT_VERSION)?
        }
        None => Docker::connect_with_local_defaults()?,
    };
    Ok(docker)
}

/// List containers carrying `<label>=true`.
pub async fn discover(docker: &Docker, label: &str) -> anyhow::Result<Vec<Discovered>> {
    let mut filters: HashMap<String, Vec<String>> = HashMap::new();
    filters.insert("label".to_string(), vec![format!("{label}=true")]);

    let options = ListContainersOptionsBuilder::default()
        .all(true)
        .filters(&filters)
        .build();

    let summaries = docker.list_containers(Some(options)).await?;

    let mut found = Vec::with_capacity(summaries.len());
    for summary in summaries {
        let Some(container_id) = summary.id.clone() else {
            continue;
        };
        let name = summary
            .names
            .as_ref()
            .and_then(|names| names.first())
            .map(|n| n.trim_start_matches('/').to_string())
            .unwrap_or_else(|| container_id.chars().take(12).collect());
        let service_id = summary
            .labels
            .as_ref()
            .and_then(|labels| labels.get("flightdeck.service"))
            .cloned()
            .unwrap_or_else(|| name.clone());
        let image = summary.image.clone().unwrap_or_default();
        let state = summary
            .state
            .as_ref()
            .map(state_to_str)
            .unwrap_or("unknown")
            .to_string();
        // Docker reports creation time in seconds; the wire protocol is in ms.
        let created_at = summary.created.unwrap_or(0) * 1000;

        found.push(Discovered {
            container_id,
            service_id,
            name,
            image,
            state,
            created_at,
        });
    }
    Ok(found)
}

/// Follow a container's logs and forward each line to the control plane.
/// Runs until the stream ends (container stops) or the task is aborted.
pub async fn stream_logs(
    docker: Docker,
    container_id: String,
    service_id: String,
    tx: UnboundedSender<AgentMessage>,
) {
    let options = LogsOptionsBuilder::default()
        .stdout(true)
        .stderr(true)
        .follow(true)
        .timestamps(false)
        .tail("20")
        .build();

    let mut stream = docker.logs(&container_id, Some(options));
    while let Some(item) = stream.next().await {
        match item {
            Ok(output) => {
                let (stream_name, bytes) = match output {
                    LogOutput::StdOut { message } => ("stdout", message),
                    LogOutput::StdErr { message } => ("stderr", message),
                    LogOutput::Console { message } => ("stdout", message),
                    LogOutput::StdIn { .. } => continue,
                };
                let text = String::from_utf8_lossy(bytes.as_ref());
                for line in text.lines() {
                    if line.is_empty() {
                        continue;
                    }
                    let _ = tx.send(AgentMessage::log(LogLine {
                        service_id: service_id.clone(),
                        stream: stream_name,
                        ts: now_ms(),
                        line: line.to_string(),
                    }));
                }
            }
            Err(err) => {
                tracing::warn!(container = %container_id, error = %err, "log stream ended");
                break;
            }
        }
    }
}

fn state_to_str(state: &ContainerSummaryStateEnum) -> &'static str {
    use ContainerSummaryStateEnum::*;
    match state {
        CREATED => "created",
        RUNNING => "running",
        PAUSED => "paused",
        RESTARTING => "restarting",
        REMOVING => "removing",
        EXITED => "exited",
        DEAD => "dead",
        _ => "unknown",
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
