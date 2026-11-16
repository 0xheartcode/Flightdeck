//! Wire protocol (agent -> control plane), version 1.
//!
//! This mirrors `packages/protocol/src/messages.ts` on the TypeScript side.
//! Keep the two in sync: field names are camelCase on the wire, the message
//! tag is `type`, and every message carries `v` (the protocol version).

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;

/// A command sent by the control plane to the agent (control plane -> agent).
/// Actions are allowlisted on the agent; anything unknown is rejected.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingCommand {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub action: String,
    #[allow(dead_code)]
    pub service_id: String,
    pub container_id: String,
    /// Present only for set_env: the full replacement environment.
    #[serde(default)]
    pub env: Option<Vec<EnvVar>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

/// A port the container publishes to the host. Built from Docker's own port
/// map (list_containers) — this is not a host port scan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMapping {
    pub container_port: u16,
    pub protocol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_ip: Option<String>,
    /// Published to a host port AND not bound to loopback.
    pub public: bool,
}

/// The container's address on one Docker network (from inspect).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAttachment {
    pub network: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
}

/// A domain learned from container labels only (Traefik rule or
/// `flightdeck.domain`) — never from config files.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteHint {
    pub domain: String,
    pub source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub container_id: String,
    pub state: String,
    pub host: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<Vec<EnvVar>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ports: Option<Vec<PortMapping>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub networks: Option<Vec<NetworkAttachment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routes: Option<Vec<RouteHint>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub service_id: String,
    pub stream: &'static str,
    pub ts: i64,
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub v: u8,
    pub agent_id: String,
    pub hostname: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMsg {
    pub v: u8,
    pub service: ServiceInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceGone {
    pub v: u8,
    pub service_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusMsg {
    pub v: u8,
    pub service_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogMsg {
    pub v: u8,
    pub log: LogLine,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub service_id: String,
    pub cpu_pct: f64,
    pub mem_bytes: u64,
    pub mem_limit_bytes: u64,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsMsg {
    pub v: u8,
    pub stats: Stats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub v: u8,
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Internally tagged: each variant serialises to `{ "type": "...", ... }`
/// with the inner struct's fields merged alongside the tag.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentMessage {
    Hello(Hello),
    // Boxed: ServiceInfo is by far the largest variant; boxing keeps the enum
    // small. Serde serialises the Box transparently, so the wire shape is same.
    Service(Box<ServiceMsg>),
    ServiceGone(ServiceGone),
    Status(StatusMsg),
    Log(LogMsg),
    Stats(StatsMsg),
    CommandResult(CommandResult),
}

impl AgentMessage {
    pub fn hello(agent_id: String, hostname: String) -> Self {
        AgentMessage::Hello(Hello {
            v: PROTOCOL_VERSION,
            agent_id,
            hostname,
        })
    }

    pub fn service(service: ServiceInfo) -> Self {
        AgentMessage::Service(Box::new(ServiceMsg {
            v: PROTOCOL_VERSION,
            service,
        }))
    }

    pub fn service_gone(service_id: String) -> Self {
        AgentMessage::ServiceGone(ServiceGone {
            v: PROTOCOL_VERSION,
            service_id,
        })
    }

    pub fn status(service_id: String, state: String, exit_code: Option<i64>, ts: i64) -> Self {
        AgentMessage::Status(StatusMsg {
            v: PROTOCOL_VERSION,
            service_id,
            state,
            exit_code,
            ts,
        })
    }

    pub fn log(log: LogLine) -> Self {
        AgentMessage::Log(LogMsg {
            v: PROTOCOL_VERSION,
            log,
        })
    }

    pub fn stats(stats: Stats) -> Self {
        AgentMessage::Stats(StatsMsg {
            v: PROTOCOL_VERSION,
            stats,
        })
    }

    pub fn command_result(id: String, ok: bool, error: Option<String>) -> Self {
        AgentMessage::CommandResult(CommandResult {
            v: PROTOCOL_VERSION,
            id,
            ok,
            error,
        })
    }
}
