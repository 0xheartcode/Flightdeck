//! Docker/Podman API access via bollard. Talks to the Docker-compatible
//! socket, so it works against Docker or a rootless Podman socket unchanged.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use bollard::Docker;
use bollard::config::{
    ContainerStatsResponse, ContainerSummaryNetworkSettings, ContainerSummaryStateEnum,
    PortSummary, PortSummaryTypeEnum,
};
use bollard::container::LogOutput;
use bollard::query_parameters::{
    ListContainersOptionsBuilder, LogsOptionsBuilder, StatsOptionsBuilder,
};
use futures_util::StreamExt;
use tokio::sync::mpsc::Sender;

use crate::protocol::{
    AgentMessage, EnvVar, LogLine, NetworkAttachment, PortMapping, RouteHint, Stats,
};

/// Cap a single log line so a container printing a huge line (or binary junk)
/// cannot blow up a WebSocket frame or the control plane's memory.
const MAX_LINE_LEN: usize = 8192;

/// A labelled container found during a discovery scan.
#[derive(Debug, Clone)]
pub struct Discovered {
    pub container_id: String,
    pub service_id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub created_at: i64,
    /// Last exit code, populated for exited containers.
    pub exit_code: Option<i64>,
    /// `flightdeck.repo` label (owner/name), for deploy correlation.
    pub repo: Option<String>,
    /// `flightdeck.environment` label, for deploy correlation.
    pub environment: Option<String>,
    /// The container's environment variables, populated only when env
    /// collection is enabled. None means collection was off (not "no vars").
    pub env: Option<Vec<EnvVar>>,
    /// Published host ports, from Docker's own port summary (not a port scan).
    pub ports: Option<Vec<PortMapping>>,
    /// The container's addresses on each Docker network (from the list summary).
    pub networks: Option<Vec<NetworkAttachment>>,
    /// Domains from container labels only (Traefik rule / `flightdeck.domain`).
    pub routes: Option<Vec<RouteHint>>,
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

/// Parse Docker's "KEY=VALUE" env entries into structured pairs. Splits on the
/// first '=' only (values may contain '='). An entry with no '=' becomes a key
/// with an empty value.
pub fn parse_env(entries: &[String]) -> Vec<EnvVar> {
    entries
        .iter()
        .map(|entry| match entry.split_once('=') {
            Some((key, value)) => EnvVar {
                key: key.to_string(),
                value: value.to_string(),
            },
            None => EnvVar {
                key: entry.to_string(),
                value: String::new(),
            },
        })
        .collect()
}

/// Map structured env vars to Docker's "KEY=VALUE" strings (the shape the API's
/// `Env` array expects). Pure, so it is unit-tested. Values are secrets and are
/// never logged here or by callers.
pub fn env_pairs(env: &[EnvVar]) -> Vec<String> {
    env.iter()
        .map(|v| format!("{}={}", v.key, v.value))
        .collect()
}

/// List containers carrying `<label>=true`.
///
/// When `collect_env` is true, each container's environment variables are read
/// once and cached by container id (env is immutable for a container's life, so
/// a later recreate yields a new id and a fresh read). Entries for containers
/// not seen in this scan are evicted so the cache stays bounded. Env values are
/// secrets and are never logged.
pub async fn discover(
    docker: &Docker,
    label: &str,
    collect_env: bool,
    env_cache: &mut std::collections::HashMap<String, Vec<EnvVar>>,
) -> anyhow::Result<Vec<Discovered>> {
    let mut filters: HashMap<String, Vec<String>> = HashMap::new();
    filters.insert("label".to_string(), vec![format!("{label}=true")]);

    let options = ListContainersOptionsBuilder::default()
        .all(true)
        .filters(&filters)
        .build();

    let summaries = docker.list_containers(Some(options)).await?;

    let mut found = Vec::with_capacity(summaries.len());
    let mut seen: HashSet<String> = HashSet::new();
    for summary in summaries {
        let Some(container_id) = summary.id.clone() else {
            continue;
        };
        seen.insert(container_id.clone());
        let name = summary
            .names
            .as_ref()
            .and_then(|names| names.first())
            .map(|n| n.trim_start_matches('/').to_string())
            .unwrap_or_else(|| container_id.chars().take(12).collect());
        let labels = summary.labels.as_ref();
        let service_id = labels
            .and_then(|labels| labels.get("flightdeck.service"))
            .cloned()
            .unwrap_or_else(|| name.clone());
        let repo = labels.and_then(|l| l.get("flightdeck.repo")).cloned();
        let environment = labels
            .and_then(|l| l.get("flightdeck.environment"))
            .cloned();
        let image = summary.image.clone().unwrap_or_default();
        let state = summary
            .state
            .as_ref()
            .map(state_to_str)
            .unwrap_or("unknown")
            .to_string();
        // Docker reports creation time in seconds; the wire protocol is in ms.
        let created_at = summary.created.unwrap_or(0) * 1000;

        // Only inspect stopped containers, to surface why they exited.
        let exit_code = if matches!(state.as_str(), "exited" | "dead") {
            exit_code_of(docker, &container_id).await
        } else {
            None
        };

        // Env is immutable for a container's lifetime, so inspect at most once
        // per container id and serve later scans from the cache.
        let env = if collect_env {
            if !env_cache.contains_key(&container_id) {
                let vars = env_of(docker, &container_id).await;
                env_cache.insert(container_id.clone(), vars);
            }
            env_cache.get(&container_id).cloned()
        } else {
            None
        };

        // Exposure data, all derived from metadata already in this summary.
        let ports = ports_of(summary.ports.as_deref());
        let networks = networks_of(summary.network_settings.as_ref());
        let routes = routes_of(labels);

        found.push(Discovered {
            container_id,
            service_id,
            name,
            image,
            state,
            created_at,
            exit_code,
            repo,
            environment,
            env,
            ports,
            networks,
            routes,
        });
    }

    // Evict cache entries for containers that vanished since the last scan.
    env_cache.retain(|id, _| seen.contains(id));

    Ok(found)
}

/// A host bind address that means "loopback only" (not reachable off-box).
/// `0.0.0.0` / `::` mean all interfaces and are therefore treated as public.
fn is_loopback_ip(ip: &str) -> bool {
    ip == "::1" || ip.starts_with("127.")
}

/// Build published-port mappings from Docker's own port summary. Reads Docker
/// metadata only — this is deliberately NOT a host OS port scan.
fn ports_of(ports: Option<&[PortSummary]>) -> Option<Vec<PortMapping>> {
    let ports = ports?;
    let mut out: Vec<PortMapping> = ports
        .iter()
        .map(|p| {
            let protocol = match p.typ {
                Some(PortSummaryTypeEnum::UDP) => "udp",
                Some(PortSummaryTypeEnum::SCTP) => "sctp",
                _ => "tcp",
            }
            .to_string();
            let host_ip = p.ip.clone().filter(|s| !s.is_empty());
            let host_port = p.public_port;
            // Public = actually published to a host port AND not loopback-bound.
            let public =
                host_port.is_some() && !host_ip.as_deref().map(is_loopback_ip).unwrap_or(false);
            PortMapping {
                container_port: p.private_port,
                protocol,
                host_port,
                host_ip,
                public,
            }
        })
        .collect();
    // Deterministic order so identical state produces identical messages.
    out.sort_by(|a, b| {
        (a.container_port, &a.protocol, a.host_port).cmp(&(
            b.container_port,
            &b.protocol,
            b.host_port,
        ))
    });
    (!out.is_empty()).then_some(out)
}

/// Build per-network IP attachments from the list summary (no inspect call).
fn networks_of(ns: Option<&ContainerSummaryNetworkSettings>) -> Option<Vec<NetworkAttachment>> {
    let networks = ns?.networks.as_ref()?;
    let mut out: Vec<NetworkAttachment> = networks
        .iter()
        .map(|(name, ep)| NetworkAttachment {
            network: name.clone(),
            ip_address: ep.ip_address.clone().filter(|s| !s.is_empty()),
        })
        .collect();
    out.sort_by(|a, b| a.network.cmp(&b.network));
    (!out.is_empty()).then_some(out)
}

/// Extract the host names inside Traefik `Host(\`a\`, \`b\`)` rule fragments.
/// Pure and unit-tested. Accepts backtick, single- or double-quoted names.
fn parse_host_rule(rule: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = rule;
    while let Some(idx) = rest.find("Host(") {
        rest = &rest[idx + "Host(".len()..];
        let Some(end) = rest.find(')') else { break };
        let inner = &rest[..end];
        for part in inner.split(',') {
            let domain = part.trim().trim_matches(['`', '\'', '"']).trim();
            if !domain.is_empty() {
                out.push(domain.to_string());
            }
        }
        rest = &rest[end + 1..];
    }
    out
}

/// Routing hints from container labels only — Traefik router rules and a native
/// `flightdeck.domain` — never from proxy config files. Deduplicated and sorted.
fn routes_of(labels: Option<&HashMap<String, String>>) -> Option<Vec<RouteHint>> {
    let labels = labels?;
    let mut by_domain: BTreeMap<String, RouteHint> = BTreeMap::new();

    // Native label: a single domain or a comma-separated list.
    if let Some(value) = labels.get("flightdeck.domain") {
        for domain in value.split(',') {
            let domain = domain.trim();
            if !domain.is_empty() {
                by_domain
                    .entry(domain.to_string())
                    .or_insert_with(|| RouteHint {
                        domain: domain.to_string(),
                        source: "flightdeck-label",
                        tls: None,
                    });
            }
        }
    }

    // Traefik router rules: `traefik.http.routers.<name>.rule = Host(`...`)`.
    for (key, value) in labels {
        let Some(rest) = key.strip_prefix("traefik.http.routers.") else {
            continue;
        };
        let Some(router) = rest.strip_suffix(".rule") else {
            continue;
        };
        let tls_key = format!("traefik.http.routers.{router}.tls");
        let tls_prefix = format!("{tls_key}.");
        let tls = if labels.get(&tls_key).map(String::as_str) == Some("true")
            || labels.keys().any(|k| k.starts_with(&tls_prefix))
        {
            Some(true)
        } else {
            None
        };
        for domain in parse_host_rule(value) {
            by_domain.entry(domain.clone()).or_insert(RouteHint {
                domain,
                source: "traefik-label",
                tls,
            });
        }
    }

    let out: Vec<RouteHint> = by_domain.into_values().collect();
    (!out.is_empty()).then_some(out)
}

/// Inspect a container for its environment variables. Returns an empty vec on
/// any error or when the container reports no config. Values are secrets, so
/// they are never logged here or by callers.
async fn env_of(docker: &Docker, container_id: &str) -> Vec<EnvVar> {
    let entries = docker
        .inspect_container(container_id, None)
        .await
        .ok()
        .and_then(|info| info.config)
        .and_then(|config| config.env)
        .unwrap_or_default();
    parse_env(&entries)
}

/// Inspect a container for its last exit code. Returns None on any error.
async fn exit_code_of(docker: &Docker, container_id: &str) -> Option<i64> {
    docker
        .inspect_container(container_id, None)
        .await
        .ok()
        .and_then(|info| info.state)
        .and_then(|state| state.exit_code)
}

/// Follow a container's logs and forward each line to the control plane.
/// Runs until the stream ends (container stops) or the task is aborted.
pub async fn stream_logs(
    docker: Docker,
    container_id: String,
    service_id: String,
    tx: Sender<AgentMessage>,
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
                    let line = truncate(line, MAX_LINE_LEN);
                    let _ = tx.try_send(AgentMessage::log(LogLine {
                        service_id: service_id.clone(),
                        stream: stream_name,
                        ts: now_ms(),
                        line,
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

/// Stream resource stats for a container and forward cpu/mem samples. Runs
/// until the stream ends (container stops) or the task is aborted.
pub async fn stream_stats(
    docker: Docker,
    container_id: String,
    service_id: String,
    tx: Sender<AgentMessage>,
) {
    let options = StatsOptionsBuilder::default().stream(true).build();
    let mut stream = docker.stats(&container_id, Some(options));
    while let Some(item) = stream.next().await {
        match item {
            Ok(sample) => {
                if let Some(stats) = compute_stats(&service_id, &sample) {
                    let _ = tx.try_send(AgentMessage::stats(stats));
                }
            }
            Err(_) => break,
        }
    }
}

/// Derive a Stats sample from a bollard stats response, or None if the sample
/// lacks the fields we need (e.g. a Windows container or a partial sample).
fn compute_stats(service_id: &str, s: &ContainerStatsResponse) -> Option<Stats> {
    let cpu = s.cpu_stats.as_ref()?;
    let mem = s.memory_stats.as_ref()?;
    let total = cpu.cpu_usage.as_ref().and_then(|u| u.total_usage)?;
    let pre = s.precpu_stats.as_ref();
    let pretotal = pre
        .and_then(|p| p.cpu_usage.as_ref())
        .and_then(|u| u.total_usage)
        .unwrap_or(0);
    let system = cpu.system_cpu_usage.unwrap_or(0);
    let presystem = pre.and_then(|p| p.system_cpu_usage).unwrap_or(0);
    let online = cpu.online_cpus.unwrap_or(1);

    Some(Stats {
        service_id: service_id.to_string(),
        cpu_pct: cpu_percent(total, pretotal, system, presystem, online),
        mem_bytes: mem.usage.unwrap_or(0),
        mem_limit_bytes: mem.limit.unwrap_or(0),
        ts: now_ms(),
    })
}

/// Docker's CPU-percentage formula, rounded to two decimals. Pure, so it is
/// unit-tested. Returns 0 when the deltas are not usable.
pub fn cpu_percent(total: u64, pretotal: u64, system: u64, presystem: u64, online: u32) -> f64 {
    let cpu_delta = total.saturating_sub(pretotal) as f64;
    let sys_delta = system.saturating_sub(presystem) as f64;
    if sys_delta <= 0.0 || cpu_delta <= 0.0 {
        return 0.0;
    }
    let pct = (cpu_delta / sys_delta) * f64::from(online.max(1)) * 100.0;
    (pct * 100.0).round() / 100.0
}

/// Build a globally-unique service id. Namespacing by host keeps two hosts
/// that use the same service label distinct; `duplicate` appends a short
/// container id when the same label is used twice on one host.
pub fn unique_service_id(host: &str, logical: &str, container_id: &str, duplicate: bool) -> String {
    if duplicate {
        let short = &container_id[..container_id.len().min(12)];
        format!("{host}/{logical}@{short}")
    } else {
        format!("{host}/{logical}")
    }
}

/// Restart a container by id. Uses the daemon's default stop timeout.
pub async fn restart(docker: &Docker, container_id: &str) -> anyhow::Result<()> {
    docker.restart_container(container_id, None).await?;
    Ok(())
}

/// Redeploy a container: pull its image again, then recreate it with the same
/// configuration under the same name. The old container is renamed aside first
/// so that, if creation or startup of the new one fails, we restore it rather
/// than leave the service down. This recreates in place and reattaches the
/// primary network; multi-network or compose-managed containers may need
/// manual handling.
pub async fn redeploy(docker: &Docker, container_id: &str) -> anyhow::Result<()> {
    use bollard::query_parameters::CreateImageOptionsBuilder;

    let inspect = docker.inspect_container(container_id, None).await?;
    let config = inspect
        .config
        .clone()
        .ok_or_else(|| anyhow::anyhow!("container has no config to recreate"))?;
    let image = config
        .image
        .clone()
        .ok_or_else(|| anyhow::anyhow!("container has no image"))?;
    let name = container_name(&inspect)?;

    // Pull the image (picks up a newer image for the same tag).
    let (from_image, tag) = split_image_ref(&image);
    let mut opts = CreateImageOptionsBuilder::default().from_image(&from_image);
    if let Some(tag) = &tag {
        opts = opts.tag(tag);
    }
    let mut pull = docker.create_image(Some(opts.build()), None, None);
    while let Some(item) = pull.next().await {
        item?;
    }

    // Recreate from the existing config + host config (image already pulled).
    let body = create_body_from(&config, inspect.host_config.as_ref())?;
    recreate(docker, container_id, &name, body).await
}

/// Recreate a container with a replaced environment, keeping its image and every
/// other config field. Unlike `redeploy` this does NOT pull the image: it reuses
/// the image already referenced by the container. The old container is renamed
/// aside and restored if the new one fails to start. Env values are secrets and
/// are never logged.
pub async fn set_env(docker: &Docker, container_id: &str, env: &[EnvVar]) -> anyhow::Result<()> {
    let inspect = docker.inspect_container(container_id, None).await?;
    let mut config = inspect
        .config
        .clone()
        .ok_or_else(|| anyhow::anyhow!("container has no config to recreate"))?;
    let name = container_name(&inspect)?;

    // Replace the environment only; the image, cmd, host config and everything
    // else survive the serde round-trip in create_body_from untouched.
    config.env = Some(env_pairs(env));

    let body = create_body_from(&config, inspect.host_config.as_ref())?;
    recreate(docker, container_id, &name, body).await
}

/// Extract a container's name without the leading '/'. Errors if it is missing
/// or empty, since the recreate dance needs it to reclaim the name.
fn container_name(inspect: &bollard::models::ContainerInspectResponse) -> anyhow::Result<String> {
    inspect
        .name
        .as_deref()
        .map(|n| n.trim_start_matches('/').to_string())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| anyhow::anyhow!("container has no name"))
}

/// Recreate a container in place from a prepared create body: rename the old one
/// aside so its name is free, create and start the new one under that name, and
/// on success remove the old. Any create/start failure rolls the old container
/// back. Shared by `redeploy` and `set_env` so the recreate steps live once.
async fn recreate(
    docker: &Docker,
    old_id: &str,
    name: &str,
    body: bollard::models::ContainerCreateBody,
) -> anyhow::Result<()> {
    use bollard::query_parameters::{
        CreateContainerOptionsBuilder, RemoveContainerOptionsBuilder,
        RenameContainerOptionsBuilder, StartContainerOptions,
    };

    // Move the old container aside so its name is free (rollback target).
    let backup = format!("{name}-fd-prev-{}", now_ms());
    docker
        .rename_container(
            old_id,
            RenameContainerOptionsBuilder::default()
                .name(&backup)
                .build(),
        )
        .await?;

    // Create and start the new container; roll back on any failure.
    let create = docker
        .create_container(
            Some(CreateContainerOptionsBuilder::default().name(name).build()),
            body,
        )
        .await;
    let new_id = match create {
        Ok(resp) => resp.id,
        Err(err) => {
            rollback(docker, old_id, name).await;
            return Err(anyhow::anyhow!("create failed: {err}"));
        }
    };
    if let Err(err) = docker
        .start_container(&new_id, None::<StartContainerOptions>)
        .await
    {
        let _ = docker
            .remove_container(
                &new_id,
                Some(RemoveContainerOptionsBuilder::default().force(true).build()),
            )
            .await;
        rollback(docker, old_id, name).await;
        return Err(anyhow::anyhow!("start failed: {err}"));
    }

    // Success: remove the old (renamed) container.
    let _ = docker
        .remove_container(
            old_id,
            Some(RemoveContainerOptionsBuilder::default().force(true).build()),
        )
        .await;
    Ok(())
}

/// Restore the old container after a failed redeploy: rename it back and start it.
async fn rollback(docker: &Docker, old_id: &str, name: &str) {
    use bollard::query_parameters::{RenameContainerOptionsBuilder, StartContainerOptions};
    let _ = docker
        .rename_container(
            old_id,
            RenameContainerOptionsBuilder::default().name(name).build(),
        )
        .await;
    let _ = docker
        .start_container(old_id, None::<StartContainerOptions>)
        .await;
}

/// Turn an inspected container config into a create body, carrying over the
/// host config. Uses a serde round-trip so every config field is preserved
/// without copying each one by hand (both types model the same Docker API).
fn create_body_from(
    config: &bollard::config::ContainerConfig,
    host_config: Option<&bollard::config::HostConfig>,
) -> anyhow::Result<bollard::models::ContainerCreateBody> {
    let mut body = serde_json::to_value(config)?;
    if let (serde_json::Value::Object(map), Some(hc)) = (&mut body, host_config) {
        map.insert("HostConfig".to_string(), serde_json::to_value(hc)?);
    }
    Ok(serde_json::from_value(body)?)
}

/// Split an image reference into (repository, tag). Digest refs keep the whole
/// string as the repository with no tag.
fn split_image_ref(image: &str) -> (String, Option<String>) {
    if image.contains('@') {
        return (image.to_string(), None);
    }
    let last_segment = image.rsplit('/').next().unwrap_or(image);
    match last_segment.rfind(':') {
        Some(idx) => {
            let tag = last_segment[idx + 1..].to_string();
            let repo_len = image.len() - last_segment.len() + idx;
            (image[..repo_len].to_string(), Some(tag))
        }
        None => (image.to_string(), Some("latest".to_string())),
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

/// Truncate a string to at most `max` bytes, respecting char boundaries, and
/// mark it so readers know it was clipped.
pub(crate) fn truncate(line: &str, max: usize) -> String {
    if line.len() <= max {
        return line.to_string();
    }
    let mut end = max;
    while end > 0 && !line.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [truncated]", &line[..end])
}

#[cfg(test)]
mod tests {
    use super::{
        cpu_percent, env_pairs, is_loopback_ip, parse_env, parse_host_rule, routes_of,
        split_image_ref, truncate, unique_service_id,
    };
    use crate::protocol::EnvVar;
    use std::collections::HashMap;

    #[test]
    fn env_pairs_formats_key_equals_value() {
        let env = vec![EnvVar {
            key: "A".to_string(),
            value: "1".to_string(),
        }];
        assert_eq!(env_pairs(&env), vec!["A=1".to_string()]);
    }

    #[test]
    fn env_pairs_of_empty_slice_is_empty() {
        assert!(env_pairs(&[]).is_empty());
    }

    #[test]
    fn parse_env_splits_on_first_equals_only() {
        let entries = vec![
            "K=V".to_string(),
            "K=a=b".to_string(),
            "K=".to_string(),
            "K".to_string(),
        ];
        let got = parse_env(&entries);
        assert_eq!(got.len(), 4);
        assert_eq!((got[0].key.as_str(), got[0].value.as_str()), ("K", "V"));
        assert_eq!((got[1].key.as_str(), got[1].value.as_str()), ("K", "a=b"));
        assert_eq!((got[2].key.as_str(), got[2].value.as_str()), ("K", ""));
        assert_eq!((got[3].key.as_str(), got[3].value.as_str()), ("K", ""));
    }

    #[test]
    fn parse_env_of_empty_slice_is_empty() {
        assert!(parse_env(&[]).is_empty());
    }

    #[test]
    fn split_image_ref_handles_tags_digests_and_registries() {
        assert_eq!(
            split_image_ref("alpine"),
            ("alpine".into(), Some("latest".into()))
        );
        assert_eq!(
            split_image_ref("alpine:3.20"),
            ("alpine".into(), Some("3.20".into()))
        );
        assert_eq!(
            split_image_ref("ghcr.io/acme/api:v1"),
            ("ghcr.io/acme/api".into(), Some("v1".into())),
        );
        // registry with a port must not be mistaken for a tag
        assert_eq!(
            split_image_ref("localhost:5000/app"),
            ("localhost:5000/app".into(), Some("latest".into())),
        );
        // digest pin: whole ref, no tag
        assert_eq!(
            split_image_ref("alpine@sha256:abc"),
            ("alpine@sha256:abc".into(), None)
        );
    }

    #[test]
    fn short_lines_are_unchanged() {
        assert_eq!(truncate("hello", 8192), "hello");
    }

    #[test]
    fn cpu_percent_uses_the_docker_formula() {
        // cpu_delta=1000, sys_delta=5000, 2 cpus -> (0.2)*2*100 = 40%
        assert_eq!(cpu_percent(2000, 1000, 10000, 5000, 2), 40.0);
    }

    #[test]
    fn cpu_percent_is_zero_without_usable_deltas() {
        assert_eq!(cpu_percent(1000, 1000, 5000, 5000, 2), 0.0);
        assert_eq!(cpu_percent(0, 0, 0, 0, 0), 0.0);
    }

    #[test]
    fn service_id_is_namespaced_by_host() {
        assert_eq!(
            unique_service_id("hostA", "api", "abc123", false),
            "hostA/api"
        );
    }

    #[test]
    fn service_id_disambiguates_duplicates_with_container_id() {
        let id = unique_service_id("hostA", "api", "abcdef0123456789", true);
        assert_eq!(id, "hostA/api@abcdef012345");
    }

    #[test]
    fn long_lines_are_clipped_with_marker() {
        let out = truncate(&"a".repeat(100), 10);
        assert!(out.starts_with(&"a".repeat(10)));
        assert!(out.ends_with("[truncated]"));
    }

    #[test]
    fn truncation_respects_char_boundaries() {
        // 'é' is two bytes; truncating at 5 bytes must not split it.
        let s = "ééééé";
        let out = truncate(s, 5);
        assert!(out.ends_with("[truncated]"));
    }

    #[test]
    fn loopback_detection_treats_all_interfaces_as_public() {
        assert!(is_loopback_ip("127.0.0.1"));
        assert!(is_loopback_ip("127.1.2.3"));
        assert!(is_loopback_ip("::1"));
        // 0.0.0.0 / :: mean "all interfaces" -> reachable -> not loopback.
        assert!(!is_loopback_ip("0.0.0.0"));
        assert!(!is_loopback_ip("::"));
        assert!(!is_loopback_ip("192.168.1.10"));
    }

    #[test]
    fn parse_host_rule_extracts_backtick_and_multi_host_domains() {
        assert_eq!(
            parse_host_rule("Host(`api.example.com`)"),
            vec!["api.example.com"]
        );
        assert_eq!(
            parse_host_rule("Host(`a.com`) || Host(`b.com`)"),
            vec!["a.com", "b.com"]
        );
        assert_eq!(
            parse_host_rule("Host(`a.com`,`b.com`) && PathPrefix(`/x`)"),
            vec!["a.com", "b.com"]
        );
        assert!(parse_host_rule("PathPrefix(`/only`)").is_empty());
    }

    #[test]
    fn routes_from_traefik_labels_capture_domain_and_tls() {
        let mut labels = HashMap::new();
        labels.insert(
            "traefik.http.routers.web.rule".to_string(),
            "Host(`app.example.com`)".to_string(),
        );
        labels.insert(
            "traefik.http.routers.web.tls".to_string(),
            "true".to_string(),
        );
        let routes = routes_of(Some(&labels)).expect("one route");
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].domain, "app.example.com");
        assert_eq!(routes[0].source, "traefik-label");
        assert_eq!(routes[0].tls, Some(true));
    }

    #[test]
    fn routes_from_native_label_support_comma_lists_and_dedup() {
        let mut labels = HashMap::new();
        labels.insert(
            "flightdeck.domain".to_string(),
            "one.example.com, two.example.com".to_string(),
        );
        // A Traefik rule naming the same domain must not duplicate it.
        labels.insert(
            "traefik.http.routers.r.rule".to_string(),
            "Host(`one.example.com`)".to_string(),
        );
        let routes = routes_of(Some(&labels)).expect("routes");
        let domains: Vec<&str> = routes.iter().map(|r| r.domain.as_str()).collect();
        assert_eq!(domains, vec!["one.example.com", "two.example.com"]);
    }

    #[test]
    fn routes_is_none_without_routing_labels() {
        let labels = HashMap::new();
        assert!(routes_of(Some(&labels)).is_none());
    }
}
