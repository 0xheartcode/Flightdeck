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

/// Bounded outbound queue. If the control plane is down and a container is
/// chatty, we drop new messages rather than grow memory without bound.
const CHANNEL_CAPACITY: usize = 10_000;

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

    let (tx, rx) = mpsc::channel::<AgentMessage>(CHANNEL_CAPACITY);
    let agent_id = format!("{}-{}", config.hostname, std::process::id());
    let ws_handle = tokio::spawn(ws::run(
        config.control_plane_url.clone(),
        config.token.clone(),
        agent_id,
        config.hostname.clone(),
        rx,
    ));

    // container_id -> running log + stats tasks
    let mut tasks: HashMap<String, Vec<JoinHandle<()>>> = HashMap::new();
    // container_id -> globally-unique service id (to announce removal)
    let mut service_of: HashMap<String, String> = HashMap::new();

    let mut tick = interval(Duration::from_secs(config.scan_interval.max(1)));

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("SIGINT received, shutting down");
                break;
            }
            _ = wait_terminate() => {
                tracing::info!("SIGTERM received, shutting down");
                break;
            }
            _ = tick.tick() => {
                // Reap containers whose tasks all finished (stopped container).
                // A container that restarts keeps its id, so without this the
                // dead tasks would block a respawn and collection would stop.
                tasks.retain(|_, handles| handles.iter().any(|h| !h.is_finished()));

                let found = match docker::discover(&docker, &config.label).await {
                    Ok(found) => found,
                    Err(err) => {
                        tracing::warn!(error = %err, "discovery failed (is the container socket reachable?)");
                        continue;
                    }
                };

                // Detect duplicate service labels within this host so we can
                // disambiguate them rather than collapse them into one service.
                let mut counts: HashMap<&str, usize> = HashMap::new();
                for c in &found {
                    *counts.entry(c.service_id.as_str()).or_default() += 1;
                }

                let mut seen: HashSet<String> = HashSet::new();
                for container in &found {
                    seen.insert(container.container_id.clone());

                    let duplicate = counts.get(container.service_id.as_str()).copied().unwrap_or(0) > 1;
                    let id = docker::unique_service_id(
                        &config.hostname,
                        &container.service_id,
                        &container.container_id,
                        duplicate,
                    );

                    let _ = tx.try_send(AgentMessage::service(ServiceInfo {
                        id: id.clone(),
                        name: container.name.clone(),
                        image: container.image.clone(),
                        container_id: container.container_id.clone(),
                        state: container.state.clone(),
                        host: config.hostname.clone(),
                        created_at: container.created_at,
                    }));
                    let _ = tx.try_send(AgentMessage::status(
                        id.clone(),
                        container.state.clone(),
                        container.exit_code,
                        now_ms(),
                    ));

                    if !tasks.contains_key(&container.container_id) {
                        tracing::info!(service = %id, "tracking service");
                        let logs = tokio::spawn(docker::stream_logs(
                            docker.clone(),
                            container.container_id.clone(),
                            id.clone(),
                            tx.clone(),
                        ));
                        let stats = tokio::spawn(docker::stream_stats(
                            docker.clone(),
                            container.container_id.clone(),
                            id.clone(),
                            tx.clone(),
                        ));
                        tasks.insert(container.container_id.clone(), vec![logs, stats]);
                        service_of.insert(container.container_id.clone(), id.clone());
                    }
                }

                // Reap containers that disappeared since the last scan.
                let gone: Vec<String> =
                    service_of.keys().filter(|id| !seen.contains(*id)).cloned().collect();
                for cid in gone {
                    if let Some(handles) = tasks.remove(&cid) {
                        for h in handles {
                            h.abort();
                        }
                    }
                    if let Some(service_id) = service_of.remove(&cid) {
                        tracing::info!(service = %service_id, "service gone");
                        let _ = tx.try_send(AgentMessage::service_gone(service_id));
                    }
                }
            }
        }
    }

    for handles in tasks.values() {
        for h in handles {
            h.abort();
        }
    }
    drop(tx);
    ws_handle.abort();
    Ok(())
}

/// Resolve when the process receives SIGTERM (container orchestrators send it
/// on stop). On non-unix targets this never resolves.
async fn wait_terminate() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sigterm) => {
                sigterm.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    }
    #[cfg(not(unix))]
    {
        std::future::pending::<()>().await;
    }
}
