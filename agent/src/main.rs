mod config;
mod docker;
mod protocol;
mod systemd;
mod ws;

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::sync::mpsc::{Receiver, Sender};
use tokio::task::JoinHandle;
use tokio::time::interval;

use bollard::Docker;

use crate::config::Config;
use crate::docker::now_ms;
use crate::protocol::{AgentMessage, EnvVar, IncomingCommand, ServiceInfo};

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
    tracing::info!(
        url = %config.control_plane_url,
        runtime = %config.runtime,
        host = %config.hostname,
        "flightdeck agent starting",
    );

    let (tx, rx) = mpsc::channel::<AgentMessage>(CHANNEL_CAPACITY);
    // Commands flow control-plane -> ws task -> here, where the runtime lives.
    let (cmd_tx, cmd_rx) = mpsc::channel::<IncomingCommand>(64);
    let agent_id = format!("{}-{}", config.hostname, std::process::id());
    let ws_handle = tokio::spawn(ws::run(
        config.control_plane_url.clone(),
        config.token.clone(),
        agent_id,
        config.hostname.clone(),
        rx,
        cmd_tx,
    ));

    match config.runtime.as_str() {
        "docker" => {
            let docker = docker::connect(config.docker_host.as_deref())?;
            run_docker(&config, docker, tx, cmd_rx).await;
        }
        "systemd" => run_systemd(&config, tx, cmd_rx).await,
        other => {
            ws_handle.abort();
            anyhow::bail!("unknown FD_RUNTIME '{other}' (expected 'docker' or 'systemd')");
        }
    }

    ws_handle.abort();
    Ok(())
}

/// Docker/Podman runtime loop: discover labelled containers, stream their logs
/// and stats, and execute container actions.
async fn run_docker(
    config: &Config,
    docker: Docker,
    tx: Sender<AgentMessage>,
    mut cmd_rx: Receiver<IncomingCommand>,
) {
    // container_id -> running log + stats tasks
    let mut tasks: HashMap<String, Vec<JoinHandle<()>>> = HashMap::new();
    // container_id -> globally-unique service id (to announce removal)
    let mut service_of: HashMap<String, String> = HashMap::new();
    // container_id -> env vars, cached across scans so each container is
    // inspected for its (immutable) env at most once.
    let mut env_cache: HashMap<String, Vec<EnvVar>> = HashMap::new();

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
            Some(cmd) = cmd_rx.recv() => {
                // Execute in the background so a slow restart does not stall
                // discovery or log forwarding.
                tokio::spawn(execute_command(docker.clone(), cmd, tx.clone()));
            }
            _ = tick.tick() => {
                // Reap containers whose tasks all finished (stopped container).
                // A container that restarts keeps its id, so without this the
                // dead tasks would block a respawn and collection would stop.
                tasks.retain(|_, handles| handles.iter().any(|h| !h.is_finished()));

                let found = match docker::discover(&docker, &config.label, config.collect_env, &mut env_cache).await {
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
                        repo: container.repo.clone(),
                        environment: container.environment.clone(),
                        env: container.env.clone(),
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
}

/// systemd runtime loop: discover the configured units, follow their journals,
/// and execute unit actions. Units are announced with the unit name as both the
/// service id component and the "container id" an action targets.
async fn run_systemd(
    config: &Config,
    tx: Sender<AgentMessage>,
    mut cmd_rx: Receiver<IncomingCommand>,
) {
    tracing::info!(
        units = config.systemd_units.len(),
        "systemd runtime: tracking units"
    );
    // unit -> running journal task
    let mut tasks: HashMap<String, JoinHandle<()>> = HashMap::new();
    let mut announced: HashSet<String> = HashSet::new();
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
            Some(cmd) = cmd_rx.recv() => {
                tokio::spawn(execute_systemd_command(cmd, tx.clone()));
            }
            _ = tick.tick() => {
                tasks.retain(|_, h| !h.is_finished());
                let found = systemd::discover(&config.systemd_units).await;

                let mut seen: HashSet<String> = HashSet::new();
                for unit in &found {
                    seen.insert(unit.name.clone());
                    let id = format!("{}/{}", config.hostname, unit.name);
                    let _ = tx.try_send(AgentMessage::service(ServiceInfo {
                        id: id.clone(),
                        name: unit.name.clone(),
                        image: unit.description.clone(),
                        container_id: unit.name.clone(),
                        state: unit.state.clone(),
                        host: config.hostname.clone(),
                        created_at: 0,
                        repo: None,
                        environment: None,
                        env: None,
                    }));
                    let _ = tx.try_send(AgentMessage::status(id.clone(), unit.state.clone(), None, now_ms()));

                    if !tasks.contains_key(&unit.name) {
                        tracing::info!(service = %id, "tracking unit");
                        let h = tokio::spawn(systemd::stream_logs(unit.name.clone(), id.clone(), tx.clone()));
                        tasks.insert(unit.name.clone(), h);
                        announced.insert(unit.name.clone());
                    }
                }

                // A configured unit that is no longer found (removed) is dropped.
                let gone: Vec<String> =
                    announced.iter().filter(|n| !seen.contains(*n)).cloned().collect();
                for name in gone {
                    if let Some(h) = tasks.remove(&name) {
                        h.abort();
                    }
                    announced.remove(&name);
                    let id = format!("{}/{}", config.hostname, name);
                    tracing::info!(service = %id, "unit gone");
                    let _ = tx.try_send(AgentMessage::service_gone(id));
                }
            }
        }
    }

    for h in tasks.values() {
        h.abort();
    }
    drop(tx);
}

/// Execute an allowlisted container command and report the result.
async fn execute_command(docker: Docker, cmd: IncomingCommand, tx: Sender<AgentMessage>) {
    if cmd.kind != "command" {
        return;
    }
    let outcome = match cmd.action.as_str() {
        "restart" => docker::restart(&docker, &cmd.container_id)
            .await
            .map_err(|e| e.to_string()),
        "redeploy" => docker::redeploy(&docker, &cmd.container_id)
            .await
            .map_err(|e| e.to_string()),
        "set_env" => match cmd.env.as_deref() {
            Some(env) => docker::set_env(&docker, &cmd.container_id, env)
                .await
                .map_err(|e| e.to_string()),
            None => Err("set_env requires env".to_string()),
        },
        other => Err(format!("unsupported action: {other}")),
    };
    report_command(cmd.id, &cmd.action, outcome, &tx);
}

/// Execute a unit command (only restart applies) and report the result. The
/// unit name is carried in the command's container id.
async fn execute_systemd_command(cmd: IncomingCommand, tx: Sender<AgentMessage>) {
    if cmd.kind != "command" {
        return;
    }
    let outcome = match cmd.action.as_str() {
        "restart" => systemd::restart(&cmd.container_id)
            .await
            .map_err(|e| e.to_string()),
        "redeploy" | "set_env" => Err(format!(
            "{} is not supported for the systemd runtime",
            cmd.action
        )),
        other => Err(format!("unsupported action: {other}")),
    };
    report_command(cmd.id, &cmd.action, outcome, &tx);
}

/// Log and forward a command result.
fn report_command(
    id: String,
    action: &str,
    outcome: Result<(), String>,
    tx: &Sender<AgentMessage>,
) {
    let (ok, error) = match outcome {
        Ok(()) => {
            tracing::info!(action = %action, "command ok");
            (true, None)
        }
        Err(err) => {
            tracing::warn!(action = %action, error = %err, "command failed");
            (false, Some(err))
        }
    };
    let _ = tx.try_send(AgentMessage::command_result(id, ok, error));
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
