mod config;
mod docker;
mod protocol;
mod ws;

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::interval;

use crate::config::Config;
use crate::docker::now_ms;
use crate::protocol::{AgentMessage, ServiceInfo};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = Config::load();
    let docker = docker::connect(config.docker_host.as_deref())?;
    tracing::info!(
        url = %config.control_plane_url,
        label = %config.label,
        host = %config.hostname,
        "flightdeck agent starting",
    );

    let (tx, rx) = mpsc::unbounded_channel::<AgentMessage>();
    let agent_id = format!("{}-{}", config.hostname, std::process::id());
    let ws_handle = tokio::spawn(ws::run(
        config.control_plane_url.clone(),
        config.token.clone(),
        agent_id,
        config.hostname.clone(),
        rx,
    ));

    // container_id -> running log-stream task
    let mut log_tasks: HashMap<String, JoinHandle<()>> = HashMap::new();
    // container_id -> service_id (to announce removal)
    let mut service_of: HashMap<String, String> = HashMap::new();

    let mut tick = interval(Duration::from_secs(config.scan_interval.max(1)));

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("received shutdown signal");
                break;
            }
            _ = tick.tick() => {
                let found = match docker::discover(&docker, &config.label).await {
                    Ok(found) => found,
                    Err(err) => {
                        tracing::warn!(error = %err, "discovery failed (is the container socket reachable?)");
                        continue;
                    }
                };

                let mut seen: HashSet<String> = HashSet::new();
                for container in &found {
                    seen.insert(container.container_id.clone());

                    let _ = tx.send(AgentMessage::service(ServiceInfo {
                        id: container.service_id.clone(),
                        name: container.name.clone(),
                        image: container.image.clone(),
                        container_id: container.container_id.clone(),
                        state: container.state.clone(),
                        host: config.hostname.clone(),
                        created_at: container.created_at,
                    }));
                    let _ = tx.send(AgentMessage::status(
                        container.service_id.clone(),
                        container.state.clone(),
                        None,
                        now_ms(),
                    ));

                    if !log_tasks.contains_key(&container.container_id) {
                        tracing::info!(service = %container.service_id, "tracking new service");
                        let handle = tokio::spawn(docker::stream_logs(
                            docker.clone(),
                            container.container_id.clone(),
                            container.service_id.clone(),
                            tx.clone(),
                        ));
                        log_tasks.insert(container.container_id.clone(), handle);
                        service_of.insert(container.container_id.clone(), container.service_id.clone());
                    }
                }

                // Reap containers that disappeared since the last scan.
                let gone: Vec<String> =
                    log_tasks.keys().filter(|id| !seen.contains(*id)).cloned().collect();
                for id in gone {
                    if let Some(handle) = log_tasks.remove(&id) {
                        handle.abort();
                    }
                    if let Some(service_id) = service_of.remove(&id) {
                        tracing::info!(service = %service_id, "service gone");
                        let _ = tx.send(AgentMessage::service_gone(service_id));
                    }
                }
            }
        }
    }

    for handle in log_tasks.values() {
        handle.abort();
    }
    drop(tx);
    ws_handle.abort();
    Ok(())
}
